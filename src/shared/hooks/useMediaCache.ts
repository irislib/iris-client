import {useState, useCallback} from "react"
import {AppEvent} from "@/lib/nostr"
import DebugManager from "@/utils/DebugManager"

const MAX_FETCHED_EVENTS = 50 // Reduced for mobile

export function useMediaCache() {
  const [fetchedEventsMap, setFetchedEventsMap] = useState<Map<string, AppEvent>>(
    new Map()
  )

  const handleEventFetched = useCallback((event: AppEvent) => {
    setFetchedEventsMap((prev) => {
      if (prev.has(event.id)) return prev

      const newMap = new Map(prev)
      newMap.set(event.id, event)

      // Limit memory usage by keeping only the most recent events
      if (newMap.size > MAX_FETCHED_EVENTS) {
        const entries = Array.from(newMap.entries())
        // Sort by event creation time and keep only the most recent
        entries.sort(([, a], [, b]) => (b.created_at || 0) - (a.created_at || 0))
        const limitedEntries = entries.slice(0, MAX_FETCHED_EVENTS)

        // Debug: Log when we're trimming events
        const debugManager = DebugManager
        if (debugManager.isDebugEnabled()) {
          const debugSession = debugManager.getDebugSession()
          if (debugSession) {
            debugSession.publish("mediaFeed_memory", {
              operation: "trimFetchedEvents",
              oldSize: newMap.size,
              newSize: MAX_FETCHED_EVENTS,
              eventsRemoved: newMap.size - MAX_FETCHED_EVENTS,
              timestamp: Date.now(),
            })
          }
        }

        return new Map(limitedEntries)
      }

      return newMap
    })
  }, [])

  const cleanupInvisibleEvents = useCallback(
    (visibleEvents: (AppEvent | {id: string})[]) => {
      const visibleEventIds = new Set(visibleEvents.map((e) => e.id))
      setFetchedEventsMap((prev) => {
        // Only cleanup if we have significantly more events than visible
        if (prev.size <= visibleEvents.length * 2) {
          return prev
        }

        const newMap = new Map()
        let removedCount = 0

        for (const [id, event] of prev) {
          if (visibleEventIds.has(id)) {
            newMap.set(id, event)
          } else {
            removedCount++
          }
        }

        // Debug: Log cleanup activity
        const debugManager = DebugManager
        if (removedCount > 0 && debugManager.isDebugEnabled()) {
          const debugSession = debugManager.getDebugSession()
          if (debugSession) {
            debugSession.publish("mediaFeed_memory", {
              operation: "cleanupInvisibleEvents",
              eventsRemoved: removedCount,
              remainingEvents: newMap.size,
              visibleEventsCount: visibleEvents.length,
              timestamp: Date.now(),
            })
          }
        }

        return newMap
      })
    },
    []
  )

  const clearCache = useCallback(() => {
    setFetchedEventsMap(new Map())
  }, [])

  return {
    fetchedEventsMap,
    handleEventFetched,
    cleanupInvisibleEvents,
    clearCache,
  }
}
