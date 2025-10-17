import {matchFilter, VerifiedEvent, UnsignedEvent, Filter} from "nostr-tools"
import {NDKEvent, NDKPrivateKeySigner} from "@nostr-dev-kit/ndk"

type Subscriber = {
  id: string
  filter: Filter
  onEvent: (e: VerifiedEvent) => void
  delivered: Set<string> // track event IDs already sent to this subscriber
}

export class MockRelay {
  private events: VerifiedEvent[] = []
  private subscribers: Map<string, Subscriber> = new Map()
  private subscriptionCounter = 0
  private debug: boolean = false

  constructor(debug: boolean = false) {
    this.debug = debug
  }

  getEvents(): VerifiedEvent[] {
    return [...this.events]
  }

  getSubscriptions(): Map<string, Subscriber> {
    return new Map(this.subscribers)
  }

  async publish(
    event: UnsignedEvent,
    signerSecretKey?: Uint8Array
  ): Promise<VerifiedEvent> {
    const ndkEvent = new NDKEvent()
    ndkEvent.kind = event.kind
    ndkEvent.content = event.content
    ndkEvent.tags = event.tags || []
    ndkEvent.created_at = event.created_at
    ndkEvent.pubkey = event.pubkey

    if (signerSecretKey) {
      const signer = new NDKPrivateKeySigner(signerSecretKey)
      await ndkEvent.sign(signer)
    }

    const verifiedEvent = {
      ...event,
      id: ndkEvent.id!,
      sig: ndkEvent.sig!,
      tags: ndkEvent.tags || [],
    } as VerifiedEvent

    this.events.push(verifiedEvent)

    for (const sub of this.subscribers.values()) {
      this.deliverToSubscriber(sub, verifiedEvent)
    }

    return verifiedEvent
  }

  subscribe(filter: Filter, onEvent: (event: VerifiedEvent) => void): () => void {
    this.subscriptionCounter++
    const subId = `sub-${this.subscriptionCounter}`

    const subscriber: Subscriber = {
      id: subId,
      filter,
      onEvent,
      delivered: new Set(),
    }

    this.subscribers.set(subId, subscriber)

    if (this.debug) {
      console.log("MockRelay: new subscription", subId, "with filter", filter)
      console.log(
        "MockRelay: delivering",
        this.events.length,
        "existing events to new subscriber"
      )
    }
    for (const event of this.events) {
      this.deliverToSubscriber(subscriber, event)
    }

    return () => {
      this.subscribers.delete(subId)
    }
  }
  private deliverToSubscriber(subscriber: Subscriber, event: VerifiedEvent): void {
    if (!subscriber.delivered.has(event.id) && matchFilter(subscriber.filter, event)) {
      if (this.debug) {
        console.log("Delivering event", event.id, "to subscriber", subscriber.id)
      }
      subscriber.delivered.add(event.id)
      try {
        subscriber.onEvent(event)
      } catch (error) {
        if (this.shouldIgnoreDecryptionError(error)) {
          console.warn("MockRelay: ignored decrypt error", error)
          return
        }
        throw error
      }
    }
  }

  private shouldIgnoreDecryptionError(error: unknown): boolean {
    if (!(error instanceof Error)) return false
    const message = error.message?.toLowerCase()
    if (!message) return false
    return message.includes("invalid mac") || message.includes("failed to decrypt header")
  }

  clearEvents(): void {
    this.events = []
    for (const sub of this.subscribers.values()) {
      sub.delivered.clear()
    }
  }

  reset(): void {
    this.events = []
    this.subscribers.clear()
    this.subscriptionCounter = 0
  }
}
