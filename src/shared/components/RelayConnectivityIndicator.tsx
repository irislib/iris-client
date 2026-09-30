import {RiWebhookLine} from "@remixicon/react"
import {useUIStore} from "@/stores/ui"
import {Link, useLocation} from "@/navigation"
import {useWorkerRelayStatus} from "@/shared/hooks/useWorkerRelayStatus"
import {useOnlineStatus} from "@/shared/hooks/useOnlineStatus"
import {usePeerNetwork} from "@/shared/hooks/usePeerNetwork"

interface RelayConnectivityIndicatorProps {
  className?: string
  showCount?: boolean
}

const getNetworkSettingsPath = (pathname: string) => {
  const normalizedPath = pathname.replace(/\/+$/, "") || "/"
  return normalizedPath === "/settings/network" ? "/settings" : "/settings/network"
}

export const RelayConnectivityIndicator = ({
  className = "",
  showCount = true,
}: RelayConnectivityIndicatorProps) => {
  const {showRelayIndicator} = useUIStore()
  const workerRelays = useWorkerRelayStatus()
  const {peerCount, seedCount} = usePeerNetwork()
  const location = useLocation()

  const relayCount = workerRelays.relays.filter((r) => r.status >= 5).length
  const connectionCount = relayCount + peerCount + seedCount
  const description = `${peerCount} ${peerCount === 1 ? "peer" : "peers"}, ${relayCount} ${relayCount === 1 ? "relay" : "relays"}, ${seedCount} ${seedCount === 1 ? "seed" : "seeds"} connected`

  const getColorClass = () => {
    if (peerCount > 0) return "text-[#3fb950]"
    if (connectionCount > 0) return "text-warning"
    return "text-error"
  }

  const targetPath = getNetworkSettingsPath(location.pathname)
  let connectionState = "disconnected"
  if (connectionCount > 0) connectionState = "servers"
  if (peerCount > 0) connectionState = "peers"

  if (!showRelayIndicator) return null

  return (
    <Link
      to={targetPath}
      className={`flex items-center justify-center gap-1 ${getColorClass()} ${className} hover:opacity-75 transition-opacity`}
      title={description}
      aria-label={`Network: ${description}`}
      data-testid="connectivity-indicator"
      data-connection-state={connectionState}
    >
      <RiWebhookLine className="w-5 h-5" />
      {showCount && <span className="text-sm font-bold">{connectionCount}</span>}
    </Link>
  )
}

// Separate component for use in sidebar with offline label
export const OfflineIndicator = ({className = ""}: {className?: string}) => {
  const {showRelayIndicator} = useUIStore()
  const isOnline = useOnlineStatus()
  const workerRelays = useWorkerRelayStatus()
  const {peerCount, seedCount} = usePeerNetwork()
  const location = useLocation()
  const relayCount = workerRelays.relays.filter((r) => r.status >= 5).length
  const targetPath = getNetworkSettingsPath(location.pathname)

  if (showRelayIndicator || peerCount + seedCount > 0 || (isOnline && relayCount > 0))
    return null

  return (
    <Link
      to={targetPath}
      className={`badge badge-error badge-sm ${className} hover:opacity-75 transition-opacity`}
      title="Offline"
      aria-label="Offline"
    >
      offline
    </Link>
  )
}
