import {useState, useEffect} from "react"
import {useUserStore} from "@/stores/user"
import {RiDeleteBin6Line, RiAddLine} from "@remixicon/react"
import {SettingsGroup} from "@/shared/components/settings/SettingsGroup"
import {SettingsGroupItem} from "@/shared/components/settings/SettingsGroupItem"
import {getSessionManagerAsync, getDeviceManager} from "@/shared/services/PrivateChats"
import {confirm, alert} from "@/utils/utils"
import {DevicePayload} from "nostr-double-ratchet/src"

interface DeviceInfo {
  id: string
  isCurrent: boolean
  createdAt: number
  staleAt?: number
}

const ChatSettings = () => {
  const {publicKey} = useUserStore()
  const [devices, setDevices] = useState<DeviceInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [showStale, setShowStale] = useState(false)
  const [showPairingModal, setShowPairingModal] = useState(false)
  const [pairingCodeInput, setPairingCodeInput] = useState("")
  const [addingDevice, setAddingDevice] = useState(false)
  const [pairingError, setPairingError] = useState("")

  type SessionManagerInstance = Awaited<ReturnType<typeof getSessionManagerAsync>>

  const formatDeviceFoundDate = (timestamp?: number) => {
    if (!timestamp) return null
    const normalized = timestamp > 1e12 ? timestamp : timestamp * 1000
    return new Date(normalized).toLocaleString()
  }

  const buildDeviceList = (manager: SessionManagerInstance): DeviceInfo[] => {
    if (!publicKey) return []

    const currentDeviceId = manager.getDeviceId()
    const userRecord = manager.getUserRecords().get(publicKey)

    if (!userRecord) return []

    const currentDevice = userRecord.devices.get(currentDeviceId)
    const otherDevices = Array.from(userRecord.devices.entries()).filter(
      ([deviceId]) => deviceId !== currentDeviceId
    )

    const deviceList = [currentDevice, ...otherDevices.map(([, d]) => d)]
      .filter((device) => device !== undefined)
      .map((device) => ({
        id: device.deviceId,
        isCurrent: device.deviceId === currentDeviceId,
        createdAt: device.createdAt,
        staleAt: device.staleAt,
      }))

    return deviceList
  }

  const refreshDeviceList = async (manager: SessionManagerInstance) => {
    const list = buildDeviceList(manager)
    setDevices(list)
  }

  useEffect(() => {
    const loadDeviceInfo = async () => {
      if (!publicKey) {
        setDevices([])
        setLoading(false)
        return
      }

      setLoading(true)

      try {
        const manager = await getSessionManagerAsync()
        await refreshDeviceList(manager)
      } catch (error) {
        console.error("Failed to load devices:", error)
        setDevices([])
      } finally {
        setLoading(false)
      }
    }

    loadDeviceInfo()
  }, [publicKey])

  useEffect(() => {
    if (!devices.some((device) => device.staleAt !== undefined && !device.isCurrent)) {
      setShowStale(false)
    }
  }, [devices])

  const currentDevice = devices.find((device) => device.isCurrent)
  const otherActiveDevices = devices.filter(
    (device) => !device.isCurrent && device.staleAt === undefined
  )
  const staleDevices = devices.filter(
    (device) => device.staleAt !== undefined && !device.isCurrent
  )

  const renderDeviceItem = (device: DeviceInfo, isLast: boolean) => {
    const deviceFoundDate = formatDeviceFoundDate(device.createdAt)
    const staleSinceDate = formatDeviceFoundDate(device.staleAt)
    const isStale = device.staleAt !== undefined

    return (
      <SettingsGroupItem key={device.id} isLast={isLast}>
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              <span className="font-medium font-mono text-sm">{device.id}</span>
              {device.isCurrent && (
                <span className="badge badge-primary badge-sm">Current</span>
              )}
              {isStale && <span className="badge badge-warning badge-sm">Stale</span>}
            </div>
            {deviceFoundDate && (
              <div className="text-xs text-base-content/50">
                We first found and messaged this device on {deviceFoundDate}
              </div>
            )}
            {isStale && staleSinceDate && (
              <div className="text-xs text-warning">
                Marked as stale since {staleSinceDate}.
              </div>
            )}
            {isStale && (
              <div className="text-xs text-warning">
                This invite was revoked and will no longer receive messages.
              </div>
            )}
          </div>
          {!device.isCurrent && !isStale && (
            <button
              onClick={() => handleDeleteDevice(device.id)}
              className="btn btn-ghost btn-sm text-error hover:bg-error/20 ml-4"
              title="Delete device / app invite"
            >
              <RiDeleteBin6Line size={16} />
            </button>
          )}
        </div>
      </SettingsGroupItem>
    )
  }

  const renderStaleDeviceRow = (device: DeviceInfo) => {
    const deviceFoundDate = formatDeviceFoundDate(device.createdAt)
    const staleSinceDate = formatDeviceFoundDate(device.staleAt)

    return (
      <div key={device.id} className="px-4 py-3 text-sm">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <span className="font-medium font-mono text-sm">{device.id}</span>
            <span className="badge badge-warning badge-sm">Stale</span>
          </div>
          {staleSinceDate && (
            <span className="text-xs text-base-content/50">
              Stale since {staleSinceDate}
            </span>
          )}
        </div>
        {deviceFoundDate && (
          <div className="mt-2 text-xs text-base-content/60">
            We first found and messaged this device on {deviceFoundDate}
          </div>
        )}
        <div className="mt-1 text-xs text-base-content/60">
          This invite was revoked and will no longer receive messages.
        </div>
      </div>
    )
  }

  const handleDeleteDevice = async (deviceId: string) => {
    if (!(await confirm(`Delete invite for device ${deviceId.slice(0, 8)}?`))) {
      return
    }

    try {
      setLoading(true)
      const deviceManager = getDeviceManager()
      await deviceManager.init()
      await deviceManager.revokeDevice(deviceId)
      const sessionManager = await getSessionManagerAsync()
      await refreshDeviceList(sessionManager)
      setLoading(false)
    } catch (error) {
      console.error("Failed to delete invite:", error)
      await alert("Failed to delete invite")
      setLoading(false)
    }
  }

  const handleAddDelegateDevice = async () => {
    if (!pairingCodeInput.trim()) {
      setPairingError("Please enter a pairing code")
      return
    }

    setAddingDevice(true)
    setPairingError("")

    try {
      // Parse pairing code
      let payload: DevicePayload
      try {
        payload = JSON.parse(atob(pairingCodeInput.trim()))
      } catch {
        setPairingError("Invalid pairing code format")
        setAddingDevice(false)
        return
      }

      // Validate required fields
      if (
        !payload.ephemeralPubkey ||
        !payload.sharedSecret ||
        !payload.deviceId ||
        !payload.deviceLabel ||
        !payload.identityPubkey
      ) {
        setPairingError("Pairing code is missing required fields")
        setAddingDevice(false)
        return
      }

      const deviceManager = getDeviceManager()
      await deviceManager.init()

      // Add device to InviteList
      await deviceManager.addDevice(payload)

      const sessionManager = await getSessionManagerAsync()
      await refreshDeviceList(sessionManager)
      handleClosePairingModal()
    } catch (error) {
      console.error("Failed to add delegate device:", error)
      setPairingError("Failed to add device. Please try again.")
    } finally {
      setAddingDevice(false)
    }
  }

  const handleClosePairingModal = () => {
    setShowPairingModal(false)
    setPairingCodeInput("")
    setPairingError("")
  }

  if (!publicKey) {
    return (
      <div className="bg-base-200 min-h-full">
        <div className="p-4">
          <div className="text-center py-8 text-base-content/70">
            Please sign in to manage your chat settings.
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-base-200 min-h-full">
      <div className="p-4">
        <div className="mb-6">
          <p className="text-base-content/70">
            Your devices / apps for private messaging. Each device / app has a unique
            invite that allows other users to establish secure sessions.
          </p>
        </div>

        <div className="mb-6">
          <button
            className="btn btn-primary gap-2"
            onClick={() => setShowPairingModal(true)}
          >
            <RiAddLine size={18} />
            Add Delegate Device
          </button>
        </div>

        {currentDevice && (
          <div className="mb-6">
            <SettingsGroup title="This Device">
              {renderDeviceItem(currentDevice, true)}
            </SettingsGroup>
          </div>
        )}

        <div className="space-y-6">
          <SettingsGroup title="Your Devices / Apps">
            {loading && (
              <SettingsGroupItem isLast>
                <div className="text-center py-4">
                  <p className="text-base-content/70">Loading devices / apps...</p>
                </div>
              </SettingsGroupItem>
            )}
            {!loading && otherActiveDevices.length === 0 && staleDevices.length === 0 && (
              <SettingsGroupItem isLast>
                <div className="text-center py-4">
                  <p className="text-base-content/70">No device / app invites found.</p>
                </div>
              </SettingsGroupItem>
            )}
            {!loading && (otherActiveDevices.length > 0 || staleDevices.length > 0) && (
              <>
                {otherActiveDevices.map((device, index) => {
                  const isLastActive =
                    index === otherActiveDevices.length - 1 && staleDevices.length === 0
                  return renderDeviceItem(device, isLastActive)
                })}
                {staleDevices.length > 0 && (
                  <SettingsGroupItem key="stale-section" isLast>
                    <div className="space-y-2">
                      <button
                        type="button"
                        onClick={() => setShowStale((prev) => !prev)}
                        className="flex w-full items-center justify-between rounded-lg border border-base-300 bg-base-100 px-4 py-2 text-sm font-medium text-base-content/60 hover:bg-base-200"
                      >
                        <span>
                          {showStale ? "▼" : "▶"} Stale devices ({staleDevices.length})
                        </span>
                        <span className="text-xs text-base-content/50">
                          Revoked invites, kept for reference
                        </span>
                      </button>
                      {showStale && (
                        <div className="rounded-lg border border-base-300 bg-base-100 divide-y divide-base-300">
                          {staleDevices.map((device) => renderStaleDeviceRow(device))}
                        </div>
                      )}
                    </div>
                  </SettingsGroupItem>
                )}
              </>
            )}
          </SettingsGroup>
        </div>
      </div>

      {showPairingModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="card w-full max-w-md bg-base-100 shadow-xl m-4">
            <div className="card-body">
              <h2 className="card-title">Add Delegate Device</h2>
              <p className="text-base-content/70 text-sm">
                Enter the pairing code from your delegate device. Generate a pairing code
                on the delegate device first, then paste it here.
              </p>

              <div className="form-control mt-4">
                <label className="label">
                  <span className="label-text">Pairing Code</span>
                </label>
                <textarea
                  className="textarea textarea-bordered h-24 font-mono text-xs"
                  placeholder="Paste pairing code here..."
                  value={pairingCodeInput}
                  onChange={(e) => setPairingCodeInput(e.target.value)}
                  disabled={addingDevice}
                />
              </div>

              {pairingError && (
                <div className="alert alert-error mt-2">
                  <span className="text-sm">{pairingError}</span>
                </div>
              )}

              <div className="card-actions justify-end mt-6">
                <button
                  className="btn btn-ghost"
                  onClick={handleClosePairingModal}
                  disabled={addingDevice}
                >
                  Cancel
                </button>
                <button
                  className="btn btn-primary"
                  onClick={handleAddDelegateDevice}
                  disabled={addingDevice || !pairingCodeInput.trim()}
                >
                  {addingDevice ? (
                    <span className="loading loading-spinner loading-sm" />
                  ) : (
                    "Add Device"
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default ChatSettings
