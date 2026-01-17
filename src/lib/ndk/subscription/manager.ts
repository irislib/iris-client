import {matchFilters, type VerifiedEvent} from "nostr-tools"
import {LRUCache} from "typescript-lru-cache"
import type {NDKEventId, NostrEvent} from "../events/index.js"
import {NDKEvent} from "../events/index.js"
import type {NDK} from "../ndk/index.js"
import type {NDKRelay} from "../relay/index.js"
import type {NDKSubscription} from "./index.js"

export type NDKSubscriptionId = string

type SeenEventData = {
  relays: NDKRelay[]
  processedEvent?: NDKEvent
}

/**
 * This class monitors active subscriptions.
 */
export class NDKSubscriptionManager {
  public subscriptions: Map<NDKSubscriptionId, NDKSubscription>

  // Use LRU cache instead of unbounded Map to prevent memory leaks
  // Small cache since we store full NDKEvent objects (memory intensive)
  public seenEvents = new LRUCache<NDKEventId, SeenEventData>({
    maxSize: 250,
    entryExpirationTimeInMS: 5 * 60 * 1000, // 5 minutes
  })

  constructor() {
    this.subscriptions = new Map()
  }

  public add(sub: NDKSubscription) {
    this.subscriptions.set(sub.internalId, sub)

    if (sub.onStopped) {
    }

    sub.onStopped = () => {
      this.subscriptions.delete(sub.internalId)
    }

    sub.on("close", () => {
      this.subscriptions.delete(sub.internalId)
    })
  }

  public seenEvent(eventId: NDKEventId, relay: NDKRelay, processedEvent?: NDKEvent) {
    const current = this.seenEvents.get(eventId) || {relays: []}
    if (!current.relays.some((r) => r.url === relay.url)) {
      current.relays.push(relay)
    }
    if (processedEvent && !current.processedEvent) {
      current.processedEvent = processedEvent
    }
    this.seenEvents.set(eventId, current)
  }

  /**
   * Whenever an event comes in, this function is called.
   * This function matches the received event against all the
   * known (i.e. active) NDKSubscriptions, and if it matches,
   * it sends the event to the subscription.
   *
   * This is the single place in the codebase that matches
   * incoming events with parties interested in the event.
   *
   * This is also what allows for reactivity in NDK apps, such that
   * whenever an active subscription receives an event that some
   * other active subscription would want to receive, both receive it.
   *
   * TODO This also allows for subscriptions that overlap in meaning
   * to be collapsed into one.
   *
   * I.e. if a subscription with filter: kinds: [1], authors: [alice]
   * is created and EOSEs, and then a subsequent subscription with
   * kinds: [1], authors: [alice] is created, once the second subscription
   * EOSEs we can safely close it, increment its refCount and close it,
   * and when the first subscription receives a new event from Alice this
   * code will make the second subscription receive the event even though
   * it has no active subscription on a relay.
   * @param event Raw event received from a relay
   * @param relay Relay that sent the event
   * @param optimisticPublish Whether the event is coming from an optimistic publish
   */
  public dispatchEvent(
    event: NostrEvent | NDKEvent,
    relay?: NDKRelay,
    optimisticPublish = false
  ) {
    const eventId = event.id!
    let ndkEvent: NDKEvent
    const seenData = this.seenEvents.get(eventId)

    // If already processed by another relay, use cached event
    if (seenData?.processedEvent) {
      ndkEvent = seenData.processedEvent
      // Just track this relay saw it
      if (relay) {
        this.seenEvent(eventId, relay)
      }
    } else {
      // Event should be NDKEvent from connectivity/cache/optimistic publish
      if (event instanceof NDKEvent) {
        ndkEvent = event
      } else {
        // Fallback: create NDKEvent if raw NostrEvent passed
        // Get NDK instance from any subscription
        const ndk = this.subscriptions.values().next().value?.ndk
        ndkEvent = new NDKEvent(ndk, event)
        if (ndk) ndkEvent.ndk = ndk
      }

      // Store processed event
      if (relay) {
        this.seenEvent(eventId, relay, ndkEvent)
      } else if (!seenData) {
        // Mark as seen from cache/optimistic with sentinel value
        this.seenEvents.set(eventId, {
          relays: [{url: "__cache__"} as NDKRelay],
          processedEvent: ndkEvent,
        })
      }
    }

    const subscriptions = this.subscriptions.values()
    const matchingSubs = []

    // First pass: Filter matching
    for (const sub of subscriptions) {
      if (matchFilters(sub.filters, ndkEvent.rawEvent() as VerifiedEvent)) {
        matchingSubs.push(sub)
      }
    }

    // Second pass: Relay provenance check for exclusive subscriptions
    for (const sub of matchingSubs) {
      if (sub.exclusiveRelay && sub.relaySet) {
        let shouldAccept = false

        if (optimisticPublish) {
          // Optimistic publishes are accepted if the subscription allows them
          shouldAccept = !sub.skipOptimisticPublishEvent
        } else if (!relay) {
          // Event from cache - check if any of the event's known relays
          // are in the subscription's relaySet
          const eventOnRelays = seenData?.relays || []
          shouldAccept = eventOnRelays.some((r) => sub.relaySet!.relays.has(r))
        } else {
          // Live event from a relay - check if the relay is in the subscription's relaySet
          shouldAccept = sub.relaySet.relays.has(relay)
        }

        if (!shouldAccept) {
          // Optionally log that an exclusive subscription rejected an event
          sub.debug.extend("exclusive-relay")(
            "Rejected event %s from %s (relay not in exclusive set)",
            event.id,
            relay?.url || (optimisticPublish ? "optimistic" : "cache")
          )
          continue // Skip this subscription
        }
      }

      // Pass processed NDKEvent to subscription
      sub.eventReceived(
        ndkEvent,
        relay,
        relay === undefined && !optimisticPublish,
        optimisticPublish
      )
    }
  }
}
