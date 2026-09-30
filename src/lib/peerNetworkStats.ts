import type {
  BrowserHashtreeFipsProvider,
  BrowserNetworkSnapshot,
} from "@hashtree/fips-transport/browser"

export type PeerNetworkStatus = "starting" | "ready" | "unavailable" | "unsupported"
export type PeerNetworkSnapshot = BrowserNetworkSnapshot & {
  status: PeerNetworkStatus
  rates: Record<string, {bytesSent: number; bytesReceived: number}>
  history: {timestamp: number; uploadBps: number; downloadBps: number}[]
}

let snapshot: PeerNetworkSnapshot = {
  status: "starting",
  peers: [],
  transports: {},
  rates: {},
  history: [],
}
let provider: BrowserHashtreeFipsProvider | undefined
let lastSampleAt = 0
let timer: ReturnType<typeof setInterval> | undefined
const listeners = new Set<() => void>()

export const getPeerNetworkSnapshot = () => snapshot

function publish(next: PeerNetworkSnapshot) {
  snapshot = next
  listeners.forEach((listener) => listener())
}

function sample() {
  if (!provider) return
  const next = provider.getNetworkStats()
  const now = performance.now()
  const seconds = lastSampleAt ? (now - lastSampleAt) / 1000 : 0
  const rates: PeerNetworkSnapshot["rates"] = {}
  for (const [transport, totals] of Object.entries(next.transports)) {
    const previous = snapshot.transports[transport]
    rates[transport] = {
      bytesSent:
        seconds > 0 && previous
          ? Math.max(0, totals.bytesSent - previous.bytesSent) / seconds
          : 0,
      bytesReceived:
        seconds > 0 && previous
          ? Math.max(0, totals.bytesReceived - previous.bytesReceived) / seconds
          : 0,
    }
  }
  lastSampleAt = now
  const total = Object.values(rates).reduce(
    (sum, rate) => ({
      uploadBps: sum.uploadBps + rate.bytesSent,
      downloadBps: sum.downloadBps + rate.bytesReceived,
    }),
    {uploadBps: 0, downloadBps: 0}
  )
  const history =
    seconds > 0
      ? [...snapshot.history, {timestamp: now, ...total}].slice(-30)
      : snapshot.history
  publish({...next, rates, history, status: "ready"})
}

export function subscribePeerNetwork(listener: () => void) {
  listeners.add(listener)
  if (!timer) {
    sample()
    timer = setInterval(sample, 1000)
  }
  return () => {
    listeners.delete(listener)
    if (!listeners.size) {
      clearInterval(timer)
      timer = undefined
      lastSampleAt = 0
    }
  }
}

export function setPeerNetworkStatus(status: PeerNetworkStatus) {
  publish({...snapshot, status, peers: [], rates: {}})
}

export function observePeerNetwork(next: BrowserHashtreeFipsProvider) {
  provider = next
  lastSampleAt = 0
  sample()
  const unsubscribe = next.node.on("peer", sample)
  return () => {
    unsubscribe()
    if (provider !== next) return
    provider = undefined
    lastSampleAt = 0
    setPeerNetworkStatus("unavailable")
  }
}

export function formatTraffic(bytes: number): string {
  if (bytes < 1024) return `${Math.round(bytes)} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`
}
