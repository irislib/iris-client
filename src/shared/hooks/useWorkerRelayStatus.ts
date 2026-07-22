import {useState, useEffect} from "react"
import {getWorkerTransport} from "@/utils/ndk"
import {createDebugLogger} from "@/utils/createDebugLogger"
import {DEBUG_NAMESPACES} from "@/utils/constants"

const {log} = createDebugLogger(DEBUG_NAMESPACES.NDK_WORKER)

interface RelayStatus {
  url: string
  status: number
  stats?: {
    attempts: number
    success: number
    connectedAt?: number
  }
}

/**
 * Hook to get relay status from worker thread
 * Receives push updates when relay status changes, with 5s polling fallback
 */
export function useWorkerRelayStatus() {
  const [relays, setRelays] = useState<RelayStatus[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let disposed = false
    let retryTimer: ReturnType<typeof setTimeout> | undefined
    let pollInterval: ReturnType<typeof setInterval> | undefined
    let unsubscribe: (() => void) | undefined

    const initialize = () => {
      if (disposed) return
      const transport = getWorkerTransport()
      if (!transport) {
        retryTimer = setTimeout(initialize, 250)
        return
      }

      const fetchStatus = async () => {
        try {
          const statuses = await transport.getRelayStatus()
          if (!disposed) {
            setRelays(statuses)
            setLoading(false)
          }
        } catch (error) {
          if (!disposed) {
            console.error("Failed to fetch relay status:", error)
            setLoading(false)
          }
        }
      }

      void fetchStatus()

      unsubscribe =
        "onRelayStatusUpdate" in transport
          ? (
              transport as {
                onRelayStatusUpdate: (cb: (s: RelayStatus[]) => void) => () => void
              }
            ).onRelayStatusUpdate((statuses: RelayStatus[]) => {
              if (disposed) return
              log("Received status update:", statuses)
              setRelays(statuses)
              setLoading(false)
            })
          : undefined

      pollInterval = setInterval(fetchStatus, 5000)
    }

    initialize()

    return () => {
      disposed = true
      if (retryTimer) clearTimeout(retryTimer)
      if (pollInterval) clearInterval(pollInterval)
      unsubscribe?.()
    }
  }, [])

  return {relays, loading}
}
