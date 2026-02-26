import {RiWebhookLine} from "@remixicon/react"
import {useUIStore} from "@/stores/ui"
import {Link, useLocation} from "@/navigation"
import {useWorkerRelayStatus} from "@/shared/hooks/useWorkerRelayStatus"
import {useOnlineStatus} from "@/shared/hooks/useOnlineStatus"

interface RelayConnectivityIndicatorProps {
  className?: string
  showCount?: boolean
}

export const RelayConnectivityIndicator = ({
  className = "",
  showCount = true,
}: RelayConnectivityIndicatorProps) => {
  const {showRelayIndicator} = useUIStore()
  const workerRelays = useWorkerRelayStatus()
  const location = useLocation()

  // Count connected relays from worker
  const relayCount = workerRelays.relays.filter((r) => r.status >= 5).length // NDKRelayStatus.CONNECTED = 5

  const getColorClass = () => {
    if (relayCount === 0) return "text-error"
    if (relayCount === 1) return "text-warning"
    return "text-neutral-500"
  }

  const normalizedPath = location.pathname.replace(/\/+$/, "") || "/"
  const targetPath =
    normalizedPath === "/settings/network" ? "/settings" : "/settings/network"

  if (!showRelayIndicator) return null

  return (
    <Link
      to={targetPath}
      className={`flex items-center justify-center gap-1 ${getColorClass()} ${className} hover:opacity-75 transition-opacity`}
      title={`${relayCount} relays connected`}
    >
      <RiWebhookLine className="w-5 h-5" />
      {showCount && <span className="text-sm font-bold">{relayCount}</span>}
    </Link>
  )
}

// Separate component for use in sidebar with offline label
export const OfflineIndicator = ({className = ""}: {className?: string}) => {
  const isOnline = useOnlineStatus()
  if (isOnline) return null
  return <span className={`badge badge-error badge-sm ${className}`}>offline</span>
}
