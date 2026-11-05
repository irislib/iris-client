import {useState, useCallback, useMemo} from "react"
import {getSocialGraph, DEFAULT_SOCIAL_GRAPH_ROOT} from "@/utils/socialGraph"
import {useSocialGraphStore} from "@/stores/socialGraph"
import {useUserStore} from "@/stores/user"
import {useSettingsStore} from "@/stores/settings"
import {selectSparseDiscoveryAuthors} from "@/utils/sparseDiscovery"
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
  discoveryAuthors: string[]
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
  const recommendationRoot = useMemo(() => {
    if (!rootReady) return expectedRoot
    return getSocialGraph().getFollowedByUser(expectedRoot).size > 0
      ? expectedRoot
      : DEFAULT_SOCIAL_GRAPH_ROOT
  }, [expectedRoot, graphVersion, rootReady])
  // For You is intentionally stable after loading. Popular re-captures live
  // visibility without treating every graph revision as a new feed source.
  const policyRevision = filterSeen
    ? `mounted:${recommendationRoot}`
    : `${graphVersion}/${muteListVersion}/${maxFollowDistance ?? "unlimited"}`
  // A mounted For You feed uses one graph snapshot. Live follow/mute events still
  // update the rest of the app, but they cannot reshuffle a feed the user is
  // already reading. Refreshing/remounting the feed intentionally takes a new
  // snapshot. The first follow (or removing the last one) switches between
  // discovery and the personal network immediately.
  const snapshot = useMemo<FeedGraphSnapshot | null>(() => {
    if (!rootReady) return null
    const socialGraph = getSocialGraph()
    if (socialGraph.getRoot() !== expectedRoot) return null

    const viewer = myPubKey || `anonymous:${socialGraph.getRoot()}`
    const reactionAuthors = Array.from(socialGraph.getFollowedByUser(recommendationRoot))
    const chronologicalAuthors = myPubKey
      ? Array.from(socialGraph.getFollowedByUser(recommendationRoot, true))
      : []
    const visibility = getOrCreateAlgorithmicVisibilitySnapshot(
      socialGraph,
      maxFollowDistance,
      graphVersion,
      muteListVersion,
      recommendationRoot
    )

    return {
      viewer,
      reactionAuthors: reactionAuthors.sort(),
      chronologicalAuthors: chronologicalAuthors.sort(),
      discoveryAuthors: filterSeen
        ? selectSparseDiscoveryAuthors(
            socialGraph,
            visibility,
            recommendationRoot,
            myPubKey
          )
        : [],
      policyKey: `graph=${graphVersion}/${muteListVersion}:root=${recommendationRoot}:distance=${maxFollowDistance ?? "unlimited"}`,
      visibility,
    }
  }, [expectedRoot, myPubKey, policyRevision, rootReady, recommendationRoot])
  const authorKey = snapshot?.reactionAuthors.join(",") || ""
  const chronologicalAuthorKey = snapshot?.chronologicalAuthors.join(",") || ""
  const discoveryAuthorKey = snapshot?.discoveryAuthors.join(",") || ""
  const discoveryAuthors = useMemo(
    () => (discoveryAuthorKey ? discoveryAuthorKey.split(",") : []),
    [discoveryAuthorKey]
  )
  const authors = useMemo(() => (authorKey ? authorKey.split(",") : []), [authorKey])
  const chronologicalAuthors = useMemo(
    () => (chronologicalAuthorKey ? chronologicalAuthorKey.split(",") : []),
    [chronologicalAuthorKey]
  )
  const scopeKey = snapshot
    ? `${snapshot.viewer}:${filterSeen ? snapshot.policyKey : `root=${recommendationRoot}`}:reactions=${authorKey}:chronological=${chronologicalAuthorKey}`
    : `${myPubKey || "anonymous"}:loading`
  const ready = rootReady && !!snapshot

  const currentFilters = useMemo<PopularityFilters>(() => {
    const filters = {
      since: oldestTimestamp,
      limit: LIMIT,
      // An empty author set must never become a match-all subscription while
      // the social graph is loading.
      authors,
      ready,
      scopeKey,
    }
    return filters
  }, [oldestTimestamp, authors, ready, scopeKey])

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
    discoveryAuthors,
    visibilitySnapshot: snapshot?.visibility || null,
    expandFilters,
  }
}
