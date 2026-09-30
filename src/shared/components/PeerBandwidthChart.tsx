import type {PeerNetworkSnapshot} from "@/lib/peerNetworkStats"

/** Matches Iris Kit's bandwidth chart: 30 samples, blue download, green upload. */
export function PeerBandwidthChart({history}: {history: PeerNetworkSnapshot["history"]}) {
  const peak = Math.max(
    1,
    ...history.flatMap((point) => [point.uploadBps, point.downloadBps])
  )
  const span =
    history.length > 1 ? history[history.length - 1].timestamp - history[0].timestamp : 0
  const path = (direction: "uploadBps" | "downloadBps") =>
    history
      .map((point, index) => {
        const x = 6 + (span ? (point.timestamp - history[0].timestamp) / span : 0) * 308
        const y = 66 - (point[direction] / peak) * 60
        return `${index ? "L" : "M"} ${x.toFixed(2)} ${y.toFixed(2)}`
      })
      .join(" ")
  return (
    <div className="mt-5" data-testid="peer-bandwidth-chart">
      <div className="flex justify-between text-xs text-base-content/50">
        <span>Recent bandwidth</span>
        <span>{span ? `${Math.round(span / 1000)}s` : "Live"}</span>
      </div>
      <svg
        viewBox="0 0 320 72"
        className="w-full h-[72px]"
        role="img"
        aria-label="Peer upload and download bandwidth"
      >
        <path
          d={path("downloadBps")}
          fill="none"
          stroke="#58a6ff"
          strokeWidth="2"
          strokeLinecap="round"
        />
        <path
          d={path("uploadBps")}
          fill="none"
          stroke="#3fb950"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </svg>
      <div className="flex gap-4 text-xs text-base-content/60">
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-[#3fb950]" />
          Upload
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-[#58a6ff]" />
          Download
        </span>
      </div>
    </div>
  )
}
