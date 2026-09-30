import {useSyncExternalStore} from "react"
import {getPeerNetworkSnapshot, subscribePeerNetwork} from "@/lib/peerNetworkStats"

export function usePeerNetwork() {
  const snapshot = useSyncExternalStore(subscribePeerNetwork, getPeerNetworkSnapshot)
  const peerCount = new Set(snapshot.peers.map((peer) => peer.peerId)).size
  const webRtcPeerCount = new Set(
    snapshot.peers
      .filter((peer) => peer.transport === "webrtc")
      .map((peer) => peer.peerId)
  ).size
  const seedCount = new Set(
    snapshot.peers
      .filter((peer) => peer.transport === "websocket")
      .map((peer) => peer.peerId)
  ).size
  return {...snapshot, peerCount, webRtcPeerCount, seedCount}
}
