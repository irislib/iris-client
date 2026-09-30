import {useSyncExternalStore} from "react"
import {getPeerNetworkSnapshot, subscribePeerNetwork} from "@/lib/peerNetworkStats"

export function usePeerNetwork() {
  const snapshot = useSyncExternalStore(subscribePeerNetwork, getPeerNetworkSnapshot)
  const peerCount = new Set(
    snapshot.peers
      .filter((peer) => peer.transport === "webrtc")
      .map((peer) => peer.peerId)
  ).size
  const seedCount = snapshot.peers.filter((peer) => peer.transport === "websocket").length
  return {...snapshot, peerCount, seedCount}
}
