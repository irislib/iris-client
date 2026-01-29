import {useState, useEffect, useMemo} from "react"
import {useUserStore} from "@/stores/user"
import {useDevicesStore} from "@/stores/devices"
import {RiDeleteBin6Line} from "@remixicon/react"
import {SettingsGroup} from "@/shared/components/settings/SettingsGroup"
import {SettingsGroupItem} from "@/shared/components/settings/SettingsGroupItem"
import {getDelegateManager, revokeDevice} from "@/shared/services/PrivateChats"
import {confirm, alert} from "@/utils/utils"

interface DeviceInfo {
  id: string
  isCurrent: boolean
  createdAt: number
}

const ChatSettings = () => {
  const {publicKey} = useUserStore()
  const {identityPubkey, registeredDevices, setIdentityPubkey} = useDevicesStore()
  const [revoking, setRevoking] = useState(false)

  const formatDeviceFoundDate = (timestamp?: number) => {
    if (!timestamp) return null
    const normalized = timestamp > 1e12 ? timestamp : timestamp * 1000
    return new Date(normalized).toLocaleString()
  }

  useEffect(() => {
    if (!publicKey) return

    // Set identity pubkey from DelegateManager
    try {
      const delegateManager = getDelegateManager()
      setIdentityPubkey(delegateManager.getIdentityPublicKey())
    } catch {
      // DelegateManager not initialized yet
    }
  }, [publicKey, setIdentityPubkey])

  const devices: DeviceInfo[] = useMemo(() => {
    return registeredDevices.map((device) => ({
      id: device.identityPubkey,
      isCurrent: device.identityPubkey === identityPubkey,
      createdAt: device.createdAt,
    }))
  }, [registeredDevices, identityPubkey])

  const currentDevice = devices.find((device) => device.isCurrent)
  const otherDevices = devices.filter((device) => !device.isCurrent)

  const renderDeviceItem = (device: DeviceInfo, isLast: boolean) => {
    const deviceFoundDate = formatDeviceFoundDate(device.createdAt)

    return (
      <SettingsGroupItem key={device.id} isLast={isLast}>
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              <span className="font-medium font-mono text-sm">
                {device.id.slice(0, 8)}...{device.id.slice(-8)}
              </span>
              {device.isCurrent && (
                <span className="badge badge-primary badge-sm">Current</span>
              )}
            </div>
            {deviceFoundDate && (
              <div className="text-xs text-base-content/50">
                Added on {deviceFoundDate}
              </div>
            )}
          </div>
          {!device.isCurrent && (
            <button
              onClick={() => handleDeleteDevice(device.id)}
              className="btn btn-ghost btn-sm text-error hover:bg-error/20 ml-4"
              title="Revoke device"
              disabled={revoking}
            >
              <RiDeleteBin6Line size={16} />
            </button>
          )}
        </div>
      </SettingsGroupItem>
    )
  }

  const handleDeleteDevice = async (deviceId: string) => {
    if (!(await confirm(`Revoke device ${deviceId.slice(0, 8)}...?`))) {
      return
    }

    try {
      setRevoking(true)
      await revokeDevice(deviceId)
    } catch (err) {
      console.error("Failed to revoke device:", err)
      await alert("Failed to revoke device")
    } finally {
      setRevoking(false)
    }
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
            Your devices for private messaging. Each device has a unique identity that
            allows other users to establish secure sessions.
          </p>
        </div>

        {currentDevice && (
          <div className="mb-6">
            <SettingsGroup title="This Device">
              {renderDeviceItem(currentDevice, true)}
            </SettingsGroup>
          </div>
        )}

        <div className="space-y-6">
          <SettingsGroup title="Other Devices">
            {otherDevices.length === 0 && (
              <SettingsGroupItem isLast>
                <div className="text-center py-4">
                  <p className="text-base-content/70">No other devices found.</p>
                </div>
              </SettingsGroupItem>
            )}
            {otherDevices.length > 0 &&
              otherDevices.map((device, index) =>
                renderDeviceItem(device, index === otherDevices.length - 1)
              )}
          </SettingsGroup>
        </div>
      </div>
    </div>
  )
}

export default ChatSettings
