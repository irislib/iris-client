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
    const transport = getWorkerTransport()
    if (!transport) {
      setLoading(false)
      return
    }

    const fetchStatus = async () => {
      try {
        const statuses = await transport.getRelayStatus()
        setRelays(statuses)
        setLoading(false)
      } catch (error) {
        console.error("Failed to fetch relay status:", error)
        setLoading(false)
      }
    }

    // Initial fetch
    fetchStatus()

    // Listen for push updates from worker
    const unsubscribe =
      "onRelayStatusUpdate" in transport
        ? (
            transport as {
              onRelayStatusUpdate: (cb: (s: RelayStatus[]) => void) => () => void
            }
          ).onRelayStatusUpdate((statuses: RelayStatus[]) => {
            log("Received status update:", statuses)
            setRelays(statuses)
            setLoading(false)
          })
        : undefined

    // Fallback polling every 5s in case push updates miss something
    const interval = setInterval(fetchStatus, 5000)

    return () => {
      clearInterval(interval)
      unsubscribe?.()
    }
  }, [])

  return {relays, loading}
}

/**
 * Hook to manage relays in worker
 */
export function useWorkerRelayManager() {
  const transport = getWorkerTransport()

  const addRelay = async (url: string) => {
    await transport?.addRelay(url)
  }

  const removeRelay = async (url: string) => {
    await transport?.removeRelay(url)
  }

  const connectRelay = async (url: string) => {
    await transport?.connectRelay(url)
  }

  const disconnectRelay = async (url: string) => {
    await transport?.disconnectRelay(url)
  }

  return {
    addRelay,
    removeRelay,
    connectRelay,
    disconnectRelay,
    available: !!transport,
  }
}
