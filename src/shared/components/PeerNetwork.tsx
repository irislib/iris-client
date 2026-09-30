import {usePeerNetwork} from "@/shared/hooks/usePeerNetwork"
import type {ReactNode} from "react"
import {formatTraffic} from "@/lib/peerNetworkStats"
import {Link} from "@/navigation"
import {SettingsGroup} from "./settings/SettingsGroup"
import {PeerBandwidthChart} from "./PeerBandwidthChart"

export function PeerNetworkSummary() {
  const {peerCount, webRtcPeerCount, seedCount} = usePeerNetwork()
  return (
    <Link
      to="/settings/network"
      className="flex items-center gap-2 mb-3 text-sm hover:opacity-80"
      data-testid="network-peer-summary"
    >
      <span
        className={`h-2 w-2 rounded-full ${webRtcPeerCount ? "bg-[#3fb950]" : "bg-base-content/30"}`}
        aria-hidden="true"
      />
      <span>
        {peerCount} {peerCount === 1 ? "peer" : "peers"}
      </span>
      {seedCount > 0 && (
        <span className="text-base-content/50">
          · {seedCount} {seedCount === 1 ? "seed" : "seeds"}
        </span>
      )}
    </Link>
  )
}

const transportLabels: Record<string, string> = {
  webrtc: "WebRTC",
  websocket: "FIPS WebSocket seed",
}

function TransportLabel({
  transport,
  plural = false,
}: {
  transport: string
  plural?: boolean
}) {
  if (transport !== "websocket") return transportLabels[transport] ?? transport
  return (
    <a
      href="https://fips.network"
      target="_blank"
      rel="noopener noreferrer"
      className="underline decoration-dotted underline-offset-2 hover:text-base-content"
    >
      {transportLabels.websocket}
      {plural ? "s" : ""}
    </a>
  )
}

export function PeerNetworkSettings() {
  const {peers, peerCount, status, transports, rates, history} = usePeerNetwork()
  const message = {
    unsupported: "Peer connections aren’t supported in this browser.",
    unavailable: "Peer network unavailable.",
    starting: "Connecting to peers…",
    ready: "No peers connected yet.",
  }[status]

  return (
    <div className="space-y-6" data-testid="peer-network-settings">
      <SettingsGroup title={`Peers (${peerCount})`}>
        <div className="p-4 space-y-3">
          <p className="text-sm text-base-content/60">
            Share events and cached files over WebRTC. Seeds help connect the network.
          </p>
          {!peerCount && <p className="text-sm">{message}</p>}
          {peers.map((peer) => (
            <div
              key={`${peer.transport}:${peer.address}`}
              className="flex items-center gap-3 min-w-0"
              data-testid="network-peer"
              data-transport={peer.transport}
            >
              <span
                className={`h-2 w-2 shrink-0 rounded-full ${peer.transport === "webrtc" ? "bg-[#3fb950]" : "bg-warning"}`}
                aria-hidden="true"
              />
              <div className="min-w-0 flex-1">
                <div className="font-mono text-sm truncate" title={peer.peerId}>
                  {peer.peerId.slice(0, 10)}…{peer.peerId.slice(-6)}
                </div>
                <div className="text-xs text-base-content/60">
                  <TransportLabel transport={peer.transport} /> · Connected
                </div>
              </div>
              <div className="text-xs text-right tabular-nums text-base-content/60 shrink-0">
                <div title="Received on this connection">
                  ↓ {formatTraffic(peer.bytesReceived)}
                </div>
                <div title="Sent on this connection">
                  ↑ {formatTraffic(peer.bytesSent)}
                </div>
              </div>
            </div>
          ))}
        </div>
      </SettingsGroup>
      <SettingsGroup title="Peer traffic">
        <div className="p-4" data-testid="peer-traffic">
          <div className="grid grid-cols-[1fr_auto_auto] gap-x-5 gap-y-3 text-sm tabular-nums">
            <span className="text-base-content/60">This session</span>
            <span className="text-right text-base-content/60">Received</span>
            <span className="text-right text-base-content/60">Sent</span>
            {["webrtc", "websocket"].map((transport) => (
              <TrafficRow
                key={transport}
                label={<TransportLabel transport={transport} plural />}
                totals={transports[transport]}
                rates={rates[transport]}
              />
            ))}
          </div>
          <PeerBandwidthChart history={history} />
          <p className="mt-3 text-xs text-base-content/50">
            Includes peer protocol traffic. Relay and file-server traffic is separate.
            Resets on reload.
          </p>
        </div>
      </SettingsGroup>
    </div>
  )
}

function TrafficRow({
  label,
  totals,
  rates,
}: {
  label: ReactNode
  totals?: {bytesReceived: number; bytesSent: number}
  rates?: {bytesReceived: number; bytesSent: number}
}) {
  return (
    <>
      <span className="self-center">{label}</span>
      {(["bytesReceived", "bytesSent"] as const).map((direction) => (
        <div className="text-right" key={direction}>
          <div>{formatTraffic(totals?.[direction] ?? 0)}</div>
          <div className="text-xs text-base-content/50">
            {formatTraffic(rates?.[direction] ?? 0)}/s
          </div>
        </div>
      ))}
    </>
  )
}
