import {useState, useEffect} from "react"
import {useUserStore} from "@/stores/user"
import {useUserRecordsStore} from "@/stores/userRecords"
import {RiDeleteBin6Line, RiRefreshLine} from "@remixicon/react"

interface DeviceInfo {
  id: string
  label: string
  isCurrent: boolean
  sessionCount: number
  lastSeen?: number
}

const ChatSettings = () => {
  const {
    invites,
    sessions,
    lastSeen,
    deleteInvite,
    createDefaultInvites,
    getOwnDeviceInvites,
    deviceId: currentDeviceId,
  } = useUserRecordsStore()
  const {publicKey} = useUserStore()
  const [devices, setDevices] = useState<DeviceInfo[]>([])

  useEffect(() => {
    const loadDeviceInfo = async () => {
      if (!publicKey) return

      // Get session counts and last seen per device for our own sessions
      const deviceSessions = new Map<string, number>()
      const deviceLastSeen = new Map<string, number>()

      Array.from(sessions.entries()).forEach(([sessionId]) => {
        const [userPubKey, deviceId] = sessionId.split(":", 2)
        if (userPubKey === publicKey) {
          // This is a session with one of our own devices
          const actualDeviceId = deviceId || "unknown"
          deviceSessions.set(
            actualDeviceId,
            (deviceSessions.get(actualDeviceId) || 0) + 1
          )

          const sessionLastSeen = lastSeen.get(sessionId)
          if (sessionLastSeen) {
            const currentLastSeen = deviceLastSeen.get(actualDeviceId) || 0
            if (sessionLastSeen > currentLastSeen) {
              deviceLastSeen.set(actualDeviceId, sessionLastSeen)
            }
          }
        }
      })

      // Only show devices that have local invites that belong to us
      // These are the legitimate devices we control
      const ownInvites = getOwnDeviceInvites()
      const deviceList: DeviceInfo[] = Array.from(ownInvites.entries()).map(
        ([deviceId]) => ({
          id: deviceId,
          label: `Device ${deviceId.slice(0, 8)}`,
          isCurrent: deviceId === currentDeviceId,
          sessionCount: deviceSessions.get(deviceId) || 0,
          lastSeen: deviceLastSeen.get(deviceId),
        })
      )

      // Sort: current device first, then by connection status, then by last seen
      deviceList.sort((a, b) => {
        if (a.isCurrent) return -1
        if (b.isCurrent) return 1
        return (b.lastSeen || 0) - (a.lastSeen || 0)
      })

      setDevices(deviceList)
    }

    loadDeviceInfo()

    // Debug functions removed
  }, [invites, sessions, lastSeen, publicKey, currentDeviceId])

  const handleNullifyDevice = async (deviceId: string) => {
    if (
      window.confirm(
        `Are you sure you want to nullify the invite for device ${deviceId.slice(
          0,
          8
        )}? This will prevent other users from connecting to this device for private messaging.`
      )
    ) {
      deleteInvite(deviceId)
      // Refresh the device list
      const updatedDevices = devices.filter((device) => device.id !== deviceId)
      setDevices(updatedDevices)
    }
  }

  const handleRefreshInvites = () => {
    createDefaultInvites()
  }

  const formatLastSeen = (timestamp?: number) => {
    if (!timestamp) return "Never"
    const date = new Date(timestamp)
    return date.toLocaleString()
  }

  if (!publicKey) {
    return (
      <div className="space-y-4">
        <h2 className="text-xl font-semibold">Chat Settings</h2>
        <p className="text-base-content/70">
          Please sign in to manage your chat settings.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold mb-2">Chat Settings</h2>
        <p className="text-base-content/70">
          Manage your devices for private messaging. Each device gets a unique invite that
          allows other users to establish secure sessions.
        </p>
      </div>

      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-medium">Your Devices</h3>
          <div className="flex gap-2">
            <button
              onClick={handleRefreshInvites}
              className="btn btn-ghost btn-sm"
              title="Refresh invites"
            >
              <RiRefreshLine size={16} />
            </button>
          </div>
        </div>

        {devices.length === 0 ? (
          <div className="text-center py-8 text-base-content/70">
            <p>No device invites found.</p>
            <button
              onClick={handleRefreshInvites}
              className="btn btn-primary btn-sm mt-2"
            >
              Create Device Invite
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {devices.map((device) => (
              <div
                key={device.id}
                className={`card bg-base-200 p-4 ${
                  device.isCurrent ? "ring-2 ring-primary" : ""
                }`}
              >
                <div className="flex items-start justify-between">
                  <div className="space-y-2 flex-1">
                    <div className="flex items-center gap-2">
                      <h4 className="font-medium">{device.label}</h4>
                      {device.isCurrent && (
                        <span className="badge badge-primary badge-sm">Current</span>
                      )}
                    </div>
                    <div className="text-sm text-base-content/70 space-y-1">
                      <p>ID: {device.id}</p>
                      <p>Active sessions: {device.sessionCount}</p>
                      <p>Last activity: {formatLastSeen(device.lastSeen)}</p>
                    </div>
                  </div>
                  <div className="ml-4">
                    <button
                      onClick={() => handleNullifyDevice(device.id)}
                      className="btn btn-ghost btn-sm text-error hover:bg-error/20"
                      title="Nullify device invite"
                    >
                      <RiDeleteBin6Line size={16} />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Debug section removed */}
    </div>
  )
}

export default ChatSettings
