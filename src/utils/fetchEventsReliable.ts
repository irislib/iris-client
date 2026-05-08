import {ndk} from "./ndk"
import type {NDKEvent, NDKFilter, NDKSubscription} from "@/lib/ndk"
import {createDebugLogger} from "./createDebugLogger"
import {DEBUG_NAMESPACES} from "./constants"
import {getEvent, getEventSync, cacheEvent} from "./eventCache"

const {log, warn} = createDebugLogger(DEBUG_NAMESPACES.UTILS)

interface FetchOptions {
  timeout?: number // ms to wait before resolving, undefined = no timeout
}

interface FetchResult {
  promise: Promise<NDKEvent[]>
  unsubscribe: () => void
}

/**
 * Reliable event fetching that doesn't rely on broken EOSE logic.
 * Uses subscribe internally and waits for completion or timeout.
 *
 * @param filters - NDK filters
 * @param opts - Options including timeout (default: no timeout)
 * @returns {promise, unsubscribe} - Promise resolves with events, unsubscribe cleans up subscription
 */
export function fetchEventsReliable(
  filters: NDKFilter | NDKFilter[],
  opts?: FetchOptions
): FetchResult {
  const events = new Map<string, NDKEvent>()
  const filterArray = Array.isArray(filters) ? filters : [filters]
  let resolved = false
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined
  let warningHandle: ReturnType<typeof setTimeout> | undefined
  let sub: NDKSubscription

  const finalize = (resolve: (value: NDKEvent[]) => void) => {
    if (resolved) return
    resolved = true
    if (timeoutHandle) clearTimeout(timeoutHandle)
    if (warningHandle) clearTimeout(warningHandle)
    sub.stop()
    resolve(Array.from(events.values()))
  }

  // For ID-based queries, check if we have all requested IDs
  const requestedIds = new Set<string>()
  filterArray.forEach((f) => {
    if (f.ids) {
      f.ids.forEach((id) => requestedIds.add(id))
    }
  })

  // Check cache first for ID-based queries
  if (requestedIds.size > 0) {
    for (const id of requestedIds) {
      const cached = getEventSync(id)
      if (cached) {
        events.set(id, cached)
      }
    }
    if (events.size > 0) {
      log(
        `[fetchEventsReliable] Found ${events.size}/${requestedIds.size} events in cache`
      )
    }
  }

  const promise = new Promise<NDKEvent[]>((resolve) => {
    // Log request info
    if (requestedIds.size > 0) {
      log(
        `[fetchEventsReliable] Requesting ${requestedIds.size} events by ID:`,
        Array.from(requestedIds)
          .map((id) => id.slice(0, 8))
          .join(", ")
      )
    }

    const continueAfterIdbCheck = () => {
      // If we already have all events from cache, resolve immediately
      if (requestedIds.size > 0 && events.size === requestedIds.size) {
        log(
          `[fetchEventsReliable] All ${requestedIds.size} events found in cache, resolving`
        )
        resolve(Array.from(events.values()))
        return
      }
      startSubscription(resolve)
    }

    // For ID queries, also try the persistent IDB cache for any not in the LRU.
    // The service worker writes pushed events here, so this is what makes a
    // notification click resolve immediately when the client never had the event.
    if (requestedIds.size > 0 && events.size < requestedIds.size) {
      const missing = Array.from(requestedIds).filter((id) => !events.has(id))
      Promise.all(missing.map((id) => getEvent(id)))
        .then((fromIdb) => {
          fromIdb.forEach((evt) => {
            if (evt) events.set(evt.id, evt)
          })
        })
        .catch((err) => warn("[fetchEventsReliable] IDB lookup failed:", err))
        .finally(continueAfterIdbCheck)
      return
    }

    continueAfterIdbCheck()
  })

  function startSubscription(resolve: (value: NDKEvent[]) => void) {
    // Use groupable subscriptions for ID queries to batch them together
    const isIdQuery = requestedIds.size > 0
    sub = ndk().subscribe(filterArray, {
      closeOnEose: false, // Keep subscription open
      groupable: isIdQuery, // Group ID-based queries
      groupableDelay: isIdQuery ? 200 : undefined, // 200ms delay to collect IDs
    })

    sub.on("event", (event: NDKEvent) => {
      events.set(event.id, event)
      cacheEvent(event) // Add to hot cache
      log(`[fetchEventsReliable] Received event: ${event.id.slice(0, 8)}`)

      // Early completion: if this is an ID query and we have all IDs, resolve immediately
      if (requestedIds.size > 0) {
        const haveAllIds = Array.from(requestedIds).every((id) => events.has(id))
        if (haveAllIds) {
          log(
            `[fetchEventsReliable] Got all ${requestedIds.size} requested events, resolving`
          )
          finalize(resolve)
        }
      }
    })

    sub.on("eose", () => {
      // Don't auto-resolve on EOSE - wait for timeout or ID completion
      // This prevents premature resolution when cache responds first
      log(
        `[fetchEventsReliable] EOSE received, have ${events.size}/${requestedIds.size} events`
      )
    })

    // Warning after 5 seconds if we haven't resolved
    warningHandle = setTimeout(() => {
      if (!resolved && requestedIds.size > 0) {
        const missing = Array.from(requestedIds).filter((id) => !events.has(id))
        warn(
          `[fetchEventsReliable] Still waiting after 5s. Missing ${missing.length}/${requestedIds.size} events:`,
          missing.map((id) => id.slice(0, 8)).join(", ")
        )
      }
    }, 5000)

    // Set timeout if specified
    if (opts?.timeout !== undefined) {
      timeoutHandle = setTimeout(() => {
        if (requestedIds.size > 0) {
          const missing = Array.from(requestedIds).filter((id) => !events.has(id))
          if (missing.length > 0) {
            warn(
              `[fetchEventsReliable] Timeout (${opts.timeout}ms). Got ${events.size}/${requestedIds.size}, missing:`,
              missing.map((id) => id.slice(0, 8)).join(", ")
            )
          }
        }
        finalize(resolve)
      }, opts.timeout)
    } else if (requestedIds.size === 0) {
      // Non-ID query with no timeout - wait for EOSE
      sub.on("eose", () => {
        log(
          `[fetchEventsReliable] Non-ID query EOSE, resolving with ${events.size} events`
        )
        finalize(resolve)
      })
    }
    // ID query with no timeout: subscription stays open until all IDs found or manually unsubscribed
  }

  return {
    promise,
    unsubscribe: () => {
      resolved = true
      if (timeoutHandle) clearTimeout(timeoutHandle)
      if (sub) sub.stop()
    },
  }
}

/**
 * Fetch a single event reliably
 */
export function fetchEventReliable(
  filter: string | NDKFilter,
  opts?: FetchOptions
): {promise: Promise<NDKEvent | null>; unsubscribe: () => void} {
  const filterObj = typeof filter === "string" ? {ids: [filter]} : filter
  const {promise, unsubscribe} = fetchEventsReliable(filterObj, opts)
  return {
    promise: promise.then((events) => events[0] || null),
    unsubscribe,
  }
}
