import {useSettingsStore} from "@/stores/settings"
import {useSocialGraphStore} from "@/stores/socialGraph"

/** Reconsider received events when the graph or the viewer's visibility policy changes. */
export function useVisibilityRevision(): string {
  const graph = useSocialGraphStore(
    (state) => `${state.version}:${state.muteListVersion}:${state.isReady}`
  )
  const distance = useSettingsStore((state) => state.content.maxFollowDistanceForReplies)
  return `${graph}:${distance}`
}
