import NDK, {NDKEvent, NDKFilter, NDKPrivateKeySigner} from "@/lib/ndk"
import {generateSecretKey, getPublicKey, nip44} from "nostr-tools"
import {bytesToHex, hexToBytes} from "@noble/hashes/utils.js"
import {KIND_DEBUG_DATA} from "@/utils/constants"

export class DebugSession {
  private ndk: NDK
  private privateKey: Uint8Array
  private privateKeyHex: string
  private publicKey: string
  private conversationKey: Uint8Array
  private signer: NDKPrivateKeySigner

  constructor(privateKey?: string) {
    // 1. Create nostr private key if not given
    if (privateKey) {
      // Handle hex string input
      this.privateKey = hexToBytes(privateKey)
      this.privateKeyHex = privateKey
    } else {
      this.privateKey = generateSecretKey()
      this.privateKeyHex = bytesToHex(this.privateKey)
    }

    this.publicKey = getPublicKey(this.privateKey)

    // For self-encryption, use same key for both sides of conversation
    this.conversationKey = nip44.getConversationKey(this.privateKey, this.publicKey)

    // Create signer
    this.signer = new NDKPrivateKeySigner(this.privateKeyHex)

    // 2. Create NDK instance that connects to temp.iris.to
    this.ndk = new NDK({
      explicitRelayUrls: ["wss://temp.iris.to"],
      signer: this.signer,
    })

    this.ndk.connect()
  }

  /**
   * Publish a key-value pair as an encrypted kind 30000 event
   * @param k The key
   * @param v The value to store (will be JSON stringified and encrypted)
   */
  async publish(k: string, v: unknown): Promise<void> {
    const content = nip44.encrypt(JSON.stringify(v), this.conversationKey)

    const event = new NDKEvent(this.ndk)
    event.kind = KIND_DEBUG_DATA
    event.content = content
    event.tags = [["d", k]]
    await event.publish()
  }

  /**
   * Subscribe to changes for a specific key
   * @param k The key to watch for changes
   * @param callback Function called when the key's value changes
   * @returns Unsubscribe function
   */
  subscribe(k: string, callback: (v: unknown, event: NDKEvent) => void): () => void {
    const filter: NDKFilter = {
      kinds: [KIND_DEBUG_DATA],
      authors: [this.publicKey],
      "#d": [k],
    }

    const subscription = this.ndk.subscribe(filter)

    subscription.on("event", (event) => {
      try {
        const decrypted = nip44.decrypt(event.content, this.conversationKey)
        const value = JSON.parse(decrypted)
        callback(value, event)
      } catch (error) {
        console.error("Failed to decrypt debug session event:", error)
      }
    })

    return () => {
      subscription.stop()
    }
  }

  /**
   * Get the public key for this debug session
   */
  getPublicKey(): string {
    return this.publicKey
  }

  /**
   * Get the private key for this debug session (hex format)
   */
  getPrivateKey(): string {
    return this.privateKeyHex
  }

  /**
   * Check if connected to a specific relay
   */
  isConnectedToRelay(relayUrl: string): boolean {
    const relay = this.ndk.pool.relays.get(relayUrl)
    return relay?.connected || false
  }

  /**
   * Get all relay statuses for debugging
   */
  getRelayStatuses(): Record<string, boolean> {
    const statuses: Record<string, boolean> = {}
    for (const [url, relay] of this.ndk.pool.relays) {
      statuses[url] = relay.connected
    }
    return statuses
  }

  /**
   * Close the debug session and disconnect from relays
   */
  close(): void {
    // NDK doesn't have a direct close method, but we can disconnect
    this.ndk.pool.relays.forEach((relay) => relay.disconnect())
  }
}
