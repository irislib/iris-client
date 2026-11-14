import localforage from "localforage"
import {getSocialGraph} from "./socialGraph"
import {useSocialGraphStore} from "@/stores/socialGraph"
import {PUSH_VIEWER_KEY, pushFollowsKey} from "./bulkNotificationCache"

export function savePushViewer(viewer: string) {
  void localforage.setItem(PUSH_VIEWER_KEY, viewer).catch(() => {})
}

let lastFollows: {viewer: string; revision?: string} | undefined

// Persist just the active account's public follows for a background worker.
// Graph updates for other profiles must not repeatedly copy the follow list.
export function savePushFollows(viewer: string) {
  if (
    globalThis.Notification?.permission !== "granted" ||
    !viewer ||
    !useSocialGraphStore.getState().isReady
  )
    return
  const graph = getSocialGraph()
  if (graph.getRoot() !== viewer) return
  const revision = graph.getListRevision(viewer, 3)?.id
  if (lastFollows?.viewer === viewer && lastFollows.revision === revision) return
  const snapshot = {viewer, revision}
  lastFollows = snapshot
  void localforage
    .setItem(pushFollowsKey(viewer), [...graph.getFollowedByUser(viewer)])
    .catch(() => {
      if (lastFollows === snapshot) lastFollows = undefined
    })
}
