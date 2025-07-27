import {
  NostrEvent,
  Filter,
  EventTemplate,
  getPublicKey,
  generateSecretKey,
  nip44,
} from "nostr-tools"
import {hexToBytes, bytesToHex} from "@noble/hashes/utils"
import {subscribe} from "@/utils/applesauce"

export async function createDebugEvent(
  eventTemplate: EventTemplate
): Promise<NostrEvent> {
  // Create a basic event for debugging
  return {
    ...eventTemplate,
    pubkey: "debug-pubkey",
    id: "debug-id",
    sig: "debug-sig",
  }
}

export function setupDebugRelaySubscription(
  relayUrl: string,
  filters: Filter[],
  _onEvent: (event: any) => void // renamed to avoid unused parameter warning
) {
  console.log("Debug relay subscription setup for:", relayUrl, filters)
  // Simplified debug subscription
}

export function getConnectedRelays(): string[] {
  return ["wss://relay.example.com"]
}

class DebugSessionClass {
  private privateKey: string | undefined
  private nostrSubscriptions: Map<string, any> = new Map()
  private conversationKey: Uint8Array | undefined

  constructor(privateKey?: string) {
    this.privateKey = privateKey
  }

  // Subscribe to Nostr events based on topic mapping
  subscribe(topic: string, callback: (value: any, event?: any) => void) {
    let filter: Filter

    // Map debug topics to Nostr filters with recent timestamp
    const since = Math.floor(Date.now() / 1000) - 60 // Last minute

    // Simple topic mapping - use d tag for kind 30000 events from our own pubkey
    const publicKey = this.getPublicKey()
    filter = {kinds: [30000], "#d": [topic], "#p": [publicKey], since}

    // Create Nostr subscription using applesauce - only connect to temp.iris.to for debug
    const debugRelays = ["wss://temp.iris.to"]
    const sub = subscribe(filter, undefined, debugRelays)

    console.log(`Debug subscription created for topic: ${topic}`, filter, debugRelays)

    sub.on("event", (event: NostrEvent) => {
      try {
        // Decrypt the event content using NIP-44
        const conversationKey = this.getConversationKey()
        const decryptedContent = nip44.decrypt(event.content, conversationKey)
        const data = JSON.parse(decryptedContent)
        callback(data, event)
      } catch (error) {
        console.warn("Failed to decrypt/parse debug event content:", error)
        callback(event.content, event)
      }
    })

    // Add error handling for subscription
    sub.on("error", (error: any) => {
      console.error(`Debug subscription error for topic: ${topic}`, error)
    })

    // Store subscription for cleanup
    this.nostrSubscriptions.set(topic, sub)

    // Return unsubscribe function
    return () => {
      const storedSub = this.nostrSubscriptions.get(topic)
      if (storedSub) {
        storedSub.stop()
        this.nostrSubscriptions.delete(topic)
      }
    }
  }

  getPrivateKey(): string {
    if (!this.privateKey) {
      // Generate a proper private key for debug sessions using nostr-tools
      const secretKey = generateSecretKey()
      this.privateKey = bytesToHex(secretKey)
      // Reset conversation key since private key changed
      this.conversationKey = undefined
    }
    return this.privateKey
  }

  getConversationKey(): Uint8Array {
    if (!this.conversationKey) {
      // Generate conversation key for NIP-44 encryption with self
      const privateKeyBytes = hexToBytes(this.getPrivateKey())
      const publicKey = this.getPublicKey()
      this.conversationKey = nip44.getConversationKey(privateKeyBytes, publicKey)
    }
    return this.conversationKey
  }

  getPublicKey(): string {
    const privateKey = this.getPrivateKey()
    try {
      // Convert hex string to Uint8Array for getPublicKey
      const privateKeyBytes = hexToBytes(privateKey)
      return getPublicKey(privateKeyBytes)
    } catch {
      return "debug-pubkey-" + Date.now()
    }
  }

  // Publish debug events to Nostr
  async publish(topic: string, data: any) {
    try {
      const {SimpleSigner} = await import("applesauce-signers")

      // Encrypt the content using NIP-44 with conversation key to self
      const conversationKey = this.getConversationKey()
      const encryptedContent = nip44.encrypt(JSON.stringify(data), conversationKey)
      const publicKey = this.getPublicKey()

      const eventTemplate: EventTemplate = {
        kind: 30000,
        content: encryptedContent,
        tags: [
          ["d", topic],
          ["p", publicKey],
        ],
        created_at: Math.floor(Date.now() / 1000),
      }

      // Use debug session's private key to sign the event
      const privateKeyBytes = hexToBytes(this.getPrivateKey())
      const signer = new SimpleSigner(privateKeyBytes)
      const signedEvent = await signer.signEvent(eventTemplate)

      // Publish to temp.iris.to relay
      const {getPool} = await import("@/utils/applesauce")
      const pool = getPool()
      const group = pool.group(["wss://temp.iris.to"])

      await new Promise<void>((resolve, reject) => {
        const subscription = group.event(signedEvent).subscribe({
          next: () => {
            // Silent publish
          },
          error: (error: any) => reject(error),
          complete: () => resolve(),
        })
        setTimeout(() => {
          subscription.unsubscribe()
          resolve()
        }, 5000)
      })
    } catch (error) {
      console.warn("Failed to publish debug event:", error)
    }
  }

  // Check if connected to relay (simplified)
  isConnectedToRelay(): boolean {
    return this.nostrSubscriptions.size > 0
  }

  // Close all subscriptions
  close() {
    this.nostrSubscriptions.forEach((sub) => {
      try {
        sub.stop()
      } catch (error) {
        console.warn("Error stopping subscription:", error)
      }
    })
    this.nostrSubscriptions.clear()
  }

  createEvent(template: EventTemplate) {
    return createDebugEvent(template)
  }

  setupSubscription(relayUrl: string, filters: Filter[], onEvent: (event: any) => void) {
    return setupDebugRelaySubscription(relayUrl, filters, onEvent)
  }

  getRelays() {
    return ["wss://temp.iris.to"] // Debug sessions only use temp.iris.to
  }
}

export {DebugSessionClass as DebugSession}
