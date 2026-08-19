import {useState, useCallback, useMemo} from "react"
import {getSocialGraph, DEFAULT_SOCIAL_GRAPH_ROOT} from "@/utils/socialGraph"
import {useSocialGraphStore} from "@/stores/socialGraph"
import {useUserStore} from "@/stores/user"
import {useSettingsStore} from "@/stores/settings"
import {
  getOrCreateAlgorithmicVisibilitySnapshot,
  type AlgorithmicVisibilitySnapshot,
} from "@/utils/visibility"
import {
  storeOldestTimestamp,
  getStoredOldestTimestamp,
} from "@/utils/timeRangePersistence"

const TIMESTAMP_DECREMENT = 24 * 60 * 60 // Go back 1 day when expanding
const LIMIT = 1000 // Fixed limit
const STORAGE_KEY = "PopularityFiltersOldestTimestamp"

export interface PopularityFilters {
  since: number
  limit: number
  authors: string[]
  ready: boolean
  scopeKey: string
}

interface FeedGraphSnapshot {
  viewer: string
  reactionAuthors: string[]
  chronologicalAuthors: string[]
  policyKey: string
  visibility: AlgorithmicVisibilitySnapshot
}

export default function usePopularityFilters(filterSeen?: boolean) {
  const graphReady = useSocialGraphStore((state) => state.isReady)
  const graphVersion = useSocialGraphStore((state) => state.version)
  const muteListVersion = useSocialGraphStore((state) => state.muteListVersion)
  const maxFollowDistance = useSettingsStore(
    (state) => state.content.maxFollowDistanceForReplies
  )
  const [oldestTimestamp, setOldestTimestamp] = useState(
    filterSeen
      ? getStoredOldestTimestamp(STORAGE_KEY, 48)
      : Math.floor(Date.now() / 1000) - 48 * 60 * 60
  )

  const myPubKey = useUserStore((state) => state.publicKey)
  const expectedRoot = myPubKey || DEFAULT_SOCIAL_GRAPH_ROOT
  const graphRoot = useMemo(
    () => (graphReady ? getSocialGraph().getRoot() : null),
    [graphReady, graphVersion, muteListVersion]
  )
  const rootReady = graphReady && graphRoot === expectedRoot
  // For You is intentionally stable after loading. Popular, including its
  // sidebar widgets, re-captures policy when the live graph or setting changes.
  const policyRevision = filterSeen
    ? "mounted"
    : `${graphVersion}/${muteListVersion}/${maxFollowDistance ?? "unlimited"}`
  // A mounted For You feed uses one graph snapshot. Live follow/mute events still
  // update the rest of the app, but they cannot reshuffle a feed the user is
  // already reading. Refreshing/remounting the feed intentionally takes a new
  // snapshot.
  const snapshot = useMemo<FeedGraphSnapshot | null>(() => {
    if (!rootReady) return null
    const socialGraph = getSocialGraph()
    if (socialGraph.getRoot() !== expectedRoot) return null

    const viewer = myPubKey || `anonymous:${socialGraph.getRoot()}`
    const directFollows = myPubKey
      ? Array.from(socialGraph.getFollowedByUser(myPubKey, false))
      : []
    const chronologicalAuthors = myPubKey
      ? Array.from(socialGraph.getFollowedByUser(myPubKey, true))
      : []

    let reactionAuthors = directFollows
    if (reactionAuthors.length === 0) {
      const rootFollows = Array.from(socialGraph.getFollowedByUser(socialGraph.getRoot()))
      reactionAuthors =
        rootFollows.length > 0
          ? rootFollows
          : Array.from(socialGraph.getFollowedByUser(DEFAULT_SOCIAL_GRAPH_ROOT))
    }

    return {
      viewer,
      reactionAuthors: reactionAuthors.sort(),
      chronologicalAuthors: chronologicalAuthors.sort(),
      policyKey: `graph=${graphVersion}/${muteListVersion}:distance=${maxFollowDistance ?? "unlimited"}`,
      visibility: getOrCreateAlgorithmicVisibilitySnapshot(
        socialGraph,
        maxFollowDistance,
        graphVersion,
        muteListVersion
      ),
    }
  }, [expectedRoot, myPubKey, policyRevision, rootReady])
  const authors = snapshot?.reactionAuthors || []
  const chronologicalAuthors = snapshot?.chronologicalAuthors || []
  const scopeKey = snapshot
    ? `${snapshot.viewer}:${snapshot.policyKey}:reactions=${authors.join(",")}:chronological=${chronologicalAuthors.join(",")}`
    : `${myPubKey || "anonymous"}:loading`

  const currentFilters = useMemo<PopularityFilters>(() => {
    const filters = {
      since: oldestTimestamp,
      limit: LIMIT,
      // An empty author set must never become a match-all subscription while
      // the social graph is loading.
      authors,
      ready: rootReady && !!snapshot,
      scopeKey,
    }
    return filters
  }, [oldestTimestamp, authors, rootReady, scopeKey, snapshot])

  const expandFilters = useCallback(() => {
    setOldestTimestamp((prev) => {
      const newOldestTimestamp = prev - TIMESTAMP_DECREMENT
      if (filterSeen) {
        storeOldestTimestamp(STORAGE_KEY, newOldestTimestamp)
      }
      return newOldestTimestamp
    })
  }, [filterSeen])

  return {
    currentFilters,
    chronologicalAuthors,
    visibilitySnapshot: snapshot?.visibility || null,
    expandFilters,
  }
}
