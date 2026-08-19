import {useMemo} from "react"
import {useSettingsStore} from "@/stores/settings"
import {useSocialGraphStore} from "@/stores/socialGraph"
import {useUserStore} from "@/stores/user"
import {DEFAULT_SOCIAL_GRAPH_ROOT, getSocialGraph} from "@/utils/socialGraph"
import {
  getOrCreateAlgorithmicVisibilitySnapshot,
  type AlgorithmicVisibilitySnapshot,
} from "@/utils/visibility"

interface RecommendationVisibilityState {
  ready: boolean
  snapshot: AlgorithmicVisibilitySnapshot | null
}

/**
 * Captures an atomic visibility policy after the correct viewer graph is ready.
 *
 * Sidebar recommendations must not briefly expose unknown/overmuted identities
 * while the graph is hydrating. Follow, mute, and visibility-setting changes
 * replace the whole policy at once so a mounted sidebar never mixes old and new
 * graph decisions.
 */
export default function useRecommendationVisibilitySnapshot(
  enabled = true
): RecommendationVisibilityState {
  const graphReady = useSocialGraphStore((state) => state.isReady)
  const graphVersion = useSocialGraphStore((state) => state.version)
  const muteListVersion = useSocialGraphStore((state) => state.muteListVersion)
  const viewer = useUserStore((state) => state.publicKey)
  const maxFollowDistance = useSettingsStore(
    (state) => state.content.maxFollowDistanceForReplies
  )
  const expectedRoot = viewer || DEFAULT_SOCIAL_GRAPH_ROOT

  // Reading the root is cheap. The revision subscriptions ensure a root change
  // made by the graph synchronizer causes a render even while isReady stays true.
  const graphRoot = useMemo(
    () => getSocialGraph().getRoot(),
    [graphVersion, muteListVersion]
  )
  const ready = enabled && graphReady && graphRoot === expectedRoot

  const snapshot = useMemo(() => {
    if (!ready) return null

    const graph = getSocialGraph()
    if (graph.getRoot() !== expectedRoot) return null

    return getOrCreateAlgorithmicVisibilitySnapshot(
      graph,
      maxFollowDistance,
      graphVersion,
      muteListVersion
    )
  }, [expectedRoot, graphVersion, maxFollowDistance, muteListVersion, ready])

  return {ready: ready && !!snapshot, snapshot}
}
