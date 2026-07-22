import {NDKEvent, NDKFilter, NDKSubscriptionCacheUsage} from "@/lib/ndk"
import {
  buildRuntimeBackfillFilters,
  RuntimeSubscriptionTracker,
  type NostrSubscribe,
} from "nostr-double-ratchet"

const DIRECT_MESSAGE_BACKFILL_LIMIT = 200
const RECENT_EVENT_LIMIT = 1024
const RECENT_EVENT_TTL_MS = 10 * 60 * 1000

const createDeduplicatingForwarder = <Event extends {id: string}>(
  onEvent: (event: Event) => void
) => {
  const seen = new Map<string, number>()
  let active = true

  return {
    forward(event: Event) {
      if (!active) return

      const now = Date.now()
      const previous = seen.get(event.id)
      if (previous !== undefined && now - previous <= RECENT_EVENT_TTL_MS) return

      seen.delete(event.id)
      seen.set(event.id, now)
      while (seen.size > RECENT_EVENT_LIMIT) {
        const oldest = seen.keys().next().value
        if (oldest === undefined) break
        seen.delete(oldest)
      }
      onEvent(event)
    },
    dispose() {
      active = false
      seen.clear()
    },
  }
}

interface RuntimeSubscribeNdk {
  pool: {
    connectedRelays: () => Array<{url: string}>
  }
  subscribe: (
    filter: NDKFilter,
    opts: {
      closeOnEose: boolean
      cacheUsage: NDKSubscriptionCacheUsage
      relayUrls?: string[]
    }
  ) => {
    on: (event: "event", handler: (event: NDKEvent) => void) => void
    start: () => void
    stop: () => void
  }
}

export const createRuntimeSubscribe = (
  ndkInstance: RuntimeSubscribeNdk,
  cacheUsage: NDKSubscriptionCacheUsage = NDKSubscriptionCacheUsage.PARALLEL
): NostrSubscribe => {
  const tracker = new RuntimeSubscriptionTracker()

  return (filter, onEvent) => {
    const relayUrls = ndkInstance.pool.connectedRelays().map((relay) => relay.url)
    const relayOptions = relayUrls.length > 0 ? {relayUrls} : {}
    const {forward, dispose} = createDeduplicatingForwarder(onEvent)
    const forwardEvent = (event: NDKEvent) => {
      const rawEvent =
        typeof (event as {rawEvent?: () => unknown}).rawEvent === "function"
          ? (event as {rawEvent: () => unknown}).rawEvent()
          : event
      forward(rawEvent as unknown as Parameters<typeof onEvent>[0])
    }

    const registered = tracker.registerFilter(filter)

    const liveSubscription = ndkInstance.subscribe(filter as NDKFilter, {
      closeOnEose: false,
      cacheUsage,
      ...relayOptions,
    })
    liveSubscription.on("event", forwardEvent)
    liveSubscription.start()

    const backfillSubscriptions = buildRuntimeBackfillFilters(
      registered,
      DIRECT_MESSAGE_BACKFILL_LIMIT
    ).map((backfillFilter) =>
      ndkInstance.subscribe(backfillFilter as NDKFilter, {
        closeOnEose: true,
        cacheUsage: NDKSubscriptionCacheUsage.ONLY_RELAY,
        ...relayOptions,
      })
    )

    for (const backfillSubscription of backfillSubscriptions) {
      backfillSubscription.on("event", forwardEvent)
      backfillSubscription.start()
    }

    return () => {
      dispose()
      tracker.unregister(registered.token)
      for (const backfillSubscription of backfillSubscriptions) {
        backfillSubscription.stop()
      }
      liveSubscription.stop()
    }
  }
}
