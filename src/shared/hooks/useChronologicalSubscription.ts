import {useEffect, useRef, useState, useCallback} from "react"
import {NDKFilter} from "@/lib/ndk"
import {ndk} from "@/utils/ndk"
import {KIND_TEXT_NOTE, KIND_LONG_FORM_CONTENT} from "@/utils/constants"
import {useUserStore} from "@/stores/user"
import {seenEventIds} from "@/utils/memcache"
import {getEventReplyingTo} from "@/utils/nostr"
import {
  storeOldestTimestamp,
  getStoredOldestTimestamp,
} from "@/utils/timeRangePersistence"

const LOW_THRESHOLD = 15
const INITIAL_DATA_THRESHOLD = 5
const TIMESTAMP_DECREMENT = 24 * 60 * 60
const STORAGE_KEY = "ChronologicalFilterOldestTimestamp"

interface ChronologicalSubscriptionCache {
  authorScope?: string
  hasInitialData?: boolean
  pendingPosts?: Map<string, number>
  showingPosts?: Map<string, number>
}

export default function useChronologicalSubscription(
  cache: ChronologicalSubscriptionCache,
  filterSeen?: boolean,
  showReplies?: boolean,
  excludeOwnPosts?: boolean,
  ready = true,
  authors: string[] = [],
  graphScope = "legacy"
) {
  const myPubKey = useUserStore((state) => state.publicKey)
  const authorScope = `${graphScope}:${ready ? "ready" : "loading"}:${authors.join(",")}`
  const cacheMatchesScope = cache.authorScope === authorScope

  const initialPendingPosts =
    cacheMatchesScope && cache.pendingPosts ? cache.pendingPosts : new Map()
  const showingPosts = useRef<Map<string, number>>(
    cacheMatchesScope && cache.showingPosts ? cache.showingPosts : new Map()
  )
  const pendingPosts = useRef<Map<string, number>>(initialPendingPosts)
  const oldestEventAt = useRef<number | null>(
    initialPendingPosts.size > 0 ? Math.min(...initialPendingPosts.values()) : null
  )
  const unfilteredEventsReceivedAfterFilterChange = useRef(0)
  const expansionsWithoutNewEvents = useRef(0)
  const [oldestTimestamp, setOldestTimestamp] = useState(
    filterSeen
      ? getStoredOldestTimestamp(STORAGE_KEY, 48)
      : Math.floor(Date.now() / 1000) - 48 * 60 * 60
  )
  const [hasInitialData, setHasInitialData] = useState(
    cacheMatchesScope && (cache.hasInitialData || false)
  )
  const hasInitialDataRef = useRef(cacheMatchesScope && (cache.hasInitialData || false))
  const activeAuthorScope = useRef(authorScope)

  useEffect(() => {
    if (activeAuthorScope.current !== authorScope) {
      activeAuthorScope.current = authorScope
      pendingPosts.current = new Map()
      showingPosts.current = new Map()
      oldestEventAt.current = null
      unfilteredEventsReceivedAfterFilterChange.current = 0
      expansionsWithoutNewEvents.current = 0
      hasInitialDataRef.current = false
      setHasInitialData(false)
    }

    cache.authorScope = authorScope
    cache.hasInitialData = hasInitialDataRef.current
    cache.pendingPosts = pendingPosts.current
    cache.showingPosts = showingPosts.current
  }, [authorScope, cache])

  useEffect(() => {
    const subscribedScope = authorScope
    // Wait for follows to be loaded from social graph
    if (!ready) {
      return
    }
    if (!authors.length) {
      hasInitialDataRef.current = true
      cache.hasInitialData = true
      setHasInitialData(true)
      return
    }
    const now = Math.floor(Date.now() / 1000)
    const chronologicalFilter: NDKFilter = {
      kinds: [KIND_TEXT_NOTE, KIND_LONG_FORM_CONTENT],
      authors,
      since: oldestTimestamp,
      until: oldestEventAt.current || now,
      limit: 300,
    }

    unfilteredEventsReceivedAfterFilterChange.current = 0

    const sub = ndk().subscribe(chronologicalFilter)

    sub.on("event", (event) => {
      if (activeAuthorScope.current !== subscribedScope) return
      if (!event.created_at || !event.id) return
      if (filterSeen && seenEventIds.has(event.id)) return
      if (excludeOwnPosts && event.pubkey === myPubKey) return
      if (!showReplies && getEventReplyingTo(event)) {
        return
      }

      unfilteredEventsReceivedAfterFilterChange.current += 1

      if (!showingPosts.current.has(event.id) && !pendingPosts.current.has(event.id)) {
        pendingPosts.current.set(event.id, event.created_at)

        if (oldestEventAt.current === null || event.created_at < oldestEventAt.current) {
          oldestEventAt.current = event.created_at
        }

        expansionsWithoutNewEvents.current = 0
      }

      if (
        !hasInitialDataRef.current &&
        pendingPosts.current.size >= INITIAL_DATA_THRESHOLD
      ) {
        hasInitialDataRef.current = true
        setHasInitialData(true)
        cache.hasInitialData = true
      }

      cache.pendingPosts = pendingPosts.current
      cache.showingPosts = showingPosts.current
    })

    const timeout = setTimeout(() => {
      if (activeAuthorScope.current !== subscribedScope) return
      if (pendingPosts.current.size <= LOW_THRESHOLD) {
        if (unfilteredEventsReceivedAfterFilterChange.current === 0) {
          expansionsWithoutNewEvents.current += 1
        }
        if (expansionsWithoutNewEvents.current >= 3) {
          expansionsWithoutNewEvents.current = 0
        } else {
          expandTimestamp()
        }
      }
    }, 5000)

    return () => {
      clearTimeout(timeout)
      sub.stop()
    }
  }, [authorScope, authors, cache, oldestTimestamp, ready])

  const expandTimestamp = useCallback(() => {
    setOldestTimestamp((prev) => {
      const newOldestTimestamp = prev - TIMESTAMP_DECREMENT
      if (filterSeen) {
        storeOldestTimestamp(STORAGE_KEY, newOldestTimestamp)
      }
      return newOldestTimestamp
    })
  }, [filterSeen])

  const getNextChronological = (n: number): string[] => {
    const currentPendingCount = pendingPosts.current.size
    if (currentPendingCount <= LOW_THRESHOLD) {
      expandTimestamp()
    }

    const top = Array.from(pendingPosts.current.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, n)

    const oldestEvent = top[top.length - 1]
    if (oldestEvent && filterSeen) {
      const [, newOldestTimestamp] = oldestEvent
      storeOldestTimestamp(STORAGE_KEY, newOldestTimestamp)
    }

    top.forEach(([eventId, timestamp]) => {
      pendingPosts.current.delete(eventId)
      showingPosts.current.set(eventId, timestamp)
    })

    cache.pendingPosts = pendingPosts.current
    cache.showingPosts = showingPosts.current

    return top.map(([eventId]) => eventId)
  }

  return {
    getNextChronological,
    hasInitialData: activeAuthorScope.current === authorScope && hasInitialData,
    sourceKey: authorScope,
  }
}
