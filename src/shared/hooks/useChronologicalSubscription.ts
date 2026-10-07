import {useEffect, useRef, useState, useCallback} from "react"
import {AppEvent, EventFilter} from "@/lib/nostr"
import {nostr} from "@/utils/nostrClient"
import {KIND_TEXT_NOTE, KIND_LONG_FORM_CONTENT} from "@/utils/constants"
import {useUserStore} from "@/stores/user"
import {seenEventIds} from "@/utils/memcache"
import {getEventReplyingTo} from "@/utils/nostr"
import useCandidateRevision from "./useCandidateRevision"
import {orderByAuthorRound} from "@/utils/authorDiversity"
import {
  storeOldestTimestamp,
  getStoredOldestTimestamp,
} from "@/utils/timeRangePersistence"

const LOW_THRESHOLD = 15
const TIMESTAMP_DECREMENT = 24 * 60 * 60
const STORAGE_KEY = "ChronologicalFilterOldestTimestamp"

interface ChronologicalSubscriptionCache {
  authorScope?: string
  hasInitialData?: boolean
  pendingPosts?: Map<string, AppEvent>
  showingPosts?: Map<string, AppEvent>
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
  const {revision, notify} = useCandidateRevision()
  const myPubKey = useUserStore((state) => state.publicKey)
  const authorScope = `${graphScope}:${ready ? "ready" : "loading"}:${authors.join(",")}`
  const cacheMatchesScope = cache.authorScope === authorScope

  const initialPendingPosts =
    cacheMatchesScope && cache.pendingPosts ? cache.pendingPosts : new Map()
  const showingPosts = useRef<Map<string, AppEvent>>(
    cacheMatchesScope && cache.showingPosts ? cache.showingPosts : new Map()
  )
  const pendingPosts = useRef<Map<string, AppEvent>>(initialPendingPosts)
  const oldestEventAt = useRef<number | null>(
    initialPendingPosts.size > 0
      ? Math.min(...Array.from(initialPendingPosts.values(), (event) => event.created_at))
      : null
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
    const markInitialDataReady = () => {
      if (activeAuthorScope.current !== subscribedScope) return
      if (hasInitialDataRef.current) return
      hasInitialDataRef.current = true
      cache.hasInitialData = true
      setHasInitialData(true)
    }

    // Wait for follows to be loaded from social graph
    if (!ready) {
      return
    }
    if (!authors.length) {
      markInitialDataReady()
      return
    }
    const now = Math.floor(Date.now() / 1000)
    const chronologicalFilter: EventFilter = {
      kinds: [KIND_TEXT_NOTE, KIND_LONG_FORM_CONTENT],
      authors,
      since: oldestTimestamp,
      until: oldestEventAt.current || now,
      limit: 300,
    }

    unfilteredEventsReceivedAfterFilterChange.current = 0

    const sub = nostr().subscribe(chronologicalFilter)

    sub.on("event", (event) => {
      if (activeAuthorScope.current !== subscribedScope) return
      if (!event.created_at || !event.id) return
      unfilteredEventsReceivedAfterFilterChange.current += 1
      // Seen posts still establish where the next history page begins.
      if (oldestEventAt.current === null || event.created_at < oldestEventAt.current) {
        oldestEventAt.current = event.created_at
      }
      if (filterSeen && seenEventIds.has(event.id)) return
      if (excludeOwnPosts && event.pubkey === myPubKey) return
      if (!showReplies && getEventReplyingTo(event)) {
        return
      }

      if (!showingPosts.current.has(event.id) && !pendingPosts.current.has(event.id)) {
        pendingPosts.current.set(event.id, event)
        notify()

        expansionsWithoutNewEvents.current = 0
      }

      if (pendingPosts.current.size > 0) {
        markInitialDataReady()
      }

      cache.pendingPosts = pendingPosts.current
      cache.showingPosts = showingPosts.current
    })

    sub.on("eose", () => {
      if (pendingPosts.current.size > 0) markInitialDataReady()
    })

    const expansionTimer = setInterval(() => {
      if (activeAuthorScope.current !== subscribedScope) return
      // A quiet cache/relay is still pending. Do not cancel its first response
      // or turn a slow read into a false empty result.
      if (unfilteredEventsReceivedAfterFilterChange.current === 0) return
      if (pendingPosts.current.size <= LOW_THRESHOLD) {
        if (pendingPosts.current.size === 0) {
          expansionsWithoutNewEvents.current += 1
        }
        const hasPosts = pendingPosts.current.size > 0
        const exhaustedInitialWindows = expansionsWithoutNewEvents.current >= 3

        if (hasPosts) {
          markInitialDataReady()
        }

        if (exhaustedInitialWindows) {
          expansionsWithoutNewEvents.current = 0
        } else {
          expandTimestamp()
        }
      }
    }, 5000)

    return () => {
      clearInterval(expansionTimer)
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

    const chronological = Array.from(pendingPosts.current.values()).sort(
      (a, b) => b.created_at - a.created_at
    )
    const previousAuthor = Array.from(showingPosts.current.values()).at(-1)?.pubkey
    const top = orderByAuthorRound(chronological, previousAuthor).slice(0, n)

    const oldestEvent = top[top.length - 1]
    if (oldestEvent && filterSeen) {
      storeOldestTimestamp(STORAGE_KEY, Math.min(...top.map((event) => event.created_at)))
    }

    top.forEach((event) => {
      pendingPosts.current.delete(event.id)
      showingPosts.current.set(event.id, event)
    })

    cache.pendingPosts = pendingPosts.current
    cache.showingPosts = showingPosts.current

    return top.map((event) => event.id)
  }

  return {
    getNextChronological,
    hasInitialData: activeAuthorScope.current === authorScope && hasInitialData,
    sourceKey: authorScope,
    revision,
  }
}
