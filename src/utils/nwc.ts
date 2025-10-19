import {ndk} from "@/utils/ndk"
import {
  NDKEvent,
  NDKPrivateKeySigner,
  NDKRelay,
  NDKRelaySet,
  NDKSubscription,
} from "@nostr-dev-kit/ndk"
import {nip04} from "nostr-tools"

// NWC event kinds
const NWC_REQUEST_KIND = 23194
const NWC_RESPONSE_KIND = 23195

export interface NWCConfig {
  pubkey: string
  relayUrls: string[]
  secret: string
}

export interface NWCRequest {
  method: string
  params: Record<string, unknown>
}

export interface NWCResponse {
  result_type: string
  result?: Record<string, unknown>
  error?: {
    code: string
    message: string
  }
}

export class SimpleNWCWallet {
  private config: NWCConfig
  private signer: NDKPrivateKeySigner
  private relays: NDKRelay[] = []
  private subscription: NDKSubscription | undefined
  private pendingRequests = new Map<
    string,
    {
      resolve: (value: NWCResponse) => void
      reject: (error: Error) => void
      timeout: NodeJS.Timeout
    }
  >()

  constructor(config: NWCConfig) {
    this.config = config
    this.signer = new NDKPrivateKeySigner(config.secret)
  }

  async connect(): Promise<void> {
    const ndkInstance = ndk()

    // Connect to specified relays
    for (const relayUrl of this.config.relayUrls) {
      try {
        const relay = ndkInstance.pool.getRelay(relayUrl, true, true)
        if (relay) {
          this.relays.push(relay)
          // Ensure relay is connected
          await relay.connect()
          console.log(`🔗 NWC: Connected to relay ${relayUrl}`)
        }
      } catch (error) {
        console.warn(`Failed to connect to relay ${relayUrl}:`, error)
      }
    }

    // Subscribe to responses after relay connection
    await this.subscribeToResponses()
  }

  private async subscribeToResponses() {
    const ndkInstance = ndk()
    const pubkey = await this.signer.user().then((u) => u.pubkey)

    console.log(
      `🔍 NWC: Subscribing to responses from ${this.config.pubkey} to ${pubkey} on relays:`,
      this.config.relayUrls
    )

    // Create subscription with explicit relay set
    const relaySet = NDKRelaySet.fromRelayUrls(this.config.relayUrls, ndkInstance)
    this.subscription = ndkInstance.subscribe(
      {
        kinds: [NWC_RESPONSE_KIND],
        authors: [this.config.pubkey],
        "#p": [pubkey],
      },
      {
        closeOnEose: false,
        relaySet: relaySet,
      }
    )

    this.subscription.on("event", async (event: NDKEvent) => {
      // Get the request ID from the e tag
      const requestId = event.tagValue("e")

      // Check if this is a response to one of our pending requests
      if (!requestId || !this.pendingRequests.has(requestId)) {
        // Ignore responses to old requests
        return
      }

      console.log(`📨 NWC: Received response for request ${requestId}`)

      try {
        // Decrypt the content
        const decrypted = await nip04.decrypt(
          this.config.secret,
          this.config.pubkey,
          event.content
        )

        const response: NWCResponse = JSON.parse(decrypted)
        console.log(`✅ NWC: Got ${response.result_type} response`)

        // Resolve the pending request
        const pending = this.pendingRequests.get(requestId)!
        clearTimeout(pending.timeout)
        this.pendingRequests.delete(requestId)
        pending.resolve(response)
      } catch (error) {
        console.error("Failed to process NWC response:", error)
      }
    })
  }

  async sendRequest(
    method: string,
    params: Record<string, unknown> = {}
  ): Promise<NWCResponse> {
    const ndkInstance = ndk()

    // Create the request
    const request: NWCRequest = {method, params}
    const requestJson = JSON.stringify(request)

    // Encrypt the request
    const encrypted = await nip04.encrypt(
      this.config.secret,
      this.config.pubkey,
      requestJson
    )

    // Create the event
    const event = new NDKEvent(ndkInstance)
    event.kind = NWC_REQUEST_KIND
    event.content = encrypted
    event.tags = [["p", this.config.pubkey]]
    event.ndk = ndkInstance

    // Sign with our signer
    await event.sign(this.signer)

    // Create a promise for the response
    const responsePromise = new Promise<NWCResponse>((resolve, reject) => {
      // 15 second timeout for all requests
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(event.id)
        reject(new Error(`NWC request ${method} timed out`))
      }, 15000)

      this.pendingRequests.set(event.id, {resolve, reject, timeout})
    })

    // Publish the event to specific relays
    console.log(
      `📤 NWC: Publishing request ${event.id} for ${method} to relays:`,
      this.config.relayUrls
    )
    const relaySet = NDKRelaySet.fromRelayUrls(this.config.relayUrls, ndkInstance)
    await event.publish(relaySet)

    // Wait for response
    return responsePromise
  }

  async getBalance(): Promise<number | null> {
    try {
      const response = await this.sendRequest("get_balance")

      if (response.error) {
        console.error("NWC balance error:", response.error)
        return null
      }

      if (response.result && "balance" in response.result) {
        const msats = response.result.balance as number
        const bits = Math.floor(msats / 1000)
        console.log(`💰 NWC: Balance: ${bits} bits`)
        return bits
      }

      return null
    } catch (error) {
      console.error("Failed to get balance:", error)
      return null
    }
  }

  async payInvoice(invoice: string): Promise<{preimage?: string} | null> {
    try {
      const response = await this.sendRequest("pay_invoice", {invoice})

      if (response.error) {
        console.error("NWC payment error:", response.error)
        return null
      }

      if (response.result && "preimage" in response.result) {
        return {preimage: response.result.preimage as string}
      }

      return null
    } catch (error) {
      console.error("Failed to pay invoice:", error)
      return null
    }
  }

  async makeInvoice(
    amount: number,
    description?: string
  ): Promise<{invoice: string} | null> {
    try {
      // Amount should be in millisats
      const msats = amount * 1000
      const response = await this.sendRequest("make_invoice", {
        amount: msats,
        description: description || "",
      })

      if (response.error) {
        console.error("NWC invoice error:", response.error)
        return null
      }

      if (response.result && "invoice" in response.result) {
        return {invoice: response.result.invoice as string}
      }

      return null
    } catch (error) {
      console.error("Failed to create invoice:", error)
      return null
    }
  }

  disconnect() {
    // Stop subscription
    if (this.subscription) {
      this.subscription.stop()
    }

    // Clear pending requests
    for (const pending of this.pendingRequests.values()) {
      clearTimeout(pending.timeout)
      pending.reject(new Error("Wallet disconnected"))
    }
    this.pendingRequests.clear()
  }
}
