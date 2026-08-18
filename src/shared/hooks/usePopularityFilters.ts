import {useState, useCallback, useMemo} from "react"
import {getSocialGraph, DEFAULT_SOCIAL_GRAPH_ROOT} from "@/utils/socialGraph"
import {useSocialGraphStore} from "@/stores/socialGraph"
import {useUserStore} from "@/stores/user"
import {useSettingsStore} from "@/stores/settings"
import {
  createAlgorithmicVisibilitySnapshot,
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
  const [oldestTimestamp, setOldestTimestamp] = useState(
    filterSeen
      ? getStoredOldestTimestamp(STORAGE_KEY, 48)
      : Math.floor(Date.now() / 1000) - 48 * 60 * 60
  )

  const myPubKey = useUserStore((state) => state.publicKey)
  // A mounted For You feed uses one graph snapshot. Live follow/mute events still
  // update the rest of the app, but they cannot reshuffle a feed the user is
  // already reading. Refreshing/remounting the feed intentionally takes a new
  // snapshot.
  const snapshot = useMemo<FeedGraphSnapshot | null>(() => {
    if (!graphReady) return null
    const socialGraph = getSocialGraph()
    const {version, muteListVersion} = useSocialGraphStore.getState()
    const maxDistance = useSettingsStore.getState().content.maxFollowDistanceForReplies

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
      policyKey: `graph=${version}/${muteListVersion}:distance=${maxDistance ?? "unlimited"}`,
      visibility: createAlgorithmicVisibilitySnapshot(socialGraph, maxDistance),
    }
  }, [graphReady, myPubKey])
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
      ready: graphReady && !!snapshot,
      scopeKey,
    }
    return filters
  }, [oldestTimestamp, authors, graphReady, scopeKey, snapshot])

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
