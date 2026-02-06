import {useState, useEffect, useRef} from "react"
import {useDevicesStore} from "@/stores/devices"
import {
  RiComputerLine,
  RiRefreshLine,
  RiLoader4Line,
  RiDeleteBinLine,
} from "@remixicon/react"
import {
  republishInvite,
  prepareRevocation,
  publishPreparedRevocation,
  PreparedRevocation,
} from "@/shared/services/PrivateChats"
import Icon from "@/shared/components/Icons/Icon"

const getButtonText = (revoking: boolean, isCurrentDevice: boolean) => {
  if (revoking) {
    return isCurrentDevice ? "Removing..." : "Revoking..."
  }
  return isCurrentDevice ? "Remove Device" : "Revoke Device"
}

const DeviceList = () => {
  const {registeredDevices, identityPubkey} = useDevicesStore()
  const [republishing, setRepublishing] = useState(false)
  const [deviceToRevoke, setDeviceToRevoke] = useState<string | null>(null)
  const [revoking, setRevoking] = useState(false)
  const [preparedRevocation, setPreparedRevocation] = useState<PreparedRevocation | null>(
    null
  )
  const [isRemovingCurrentDevice, setIsRemovingCurrentDevice] = useState(false)
  const modalRef = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    if (deviceToRevoke && preparedRevocation) {
      modalRef.current?.showModal()
    } else {
      modalRef.current?.close()
    }
  }, [deviceToRevoke, preparedRevocation])

  const handleRepublishInvite = async () => {
    setRepublishing(true)
    try {
      await republishInvite()
    } catch (err) {
      console.error("Failed to republish invite:", err)
    } finally {
      setRepublishing(false)
    }
  }

  const handleRevokeClick = async (devicePubkey: string, isCurrentDevice = false) => {
    setRevoking(true)
    setIsRemovingCurrentDevice(isCurrentDevice)
    try {
      const prepared = await prepareRevocation(devicePubkey)
      setPreparedRevocation(prepared)
      setDeviceToRevoke(devicePubkey)
    } catch (err) {
      console.error("Failed to prepare revocation:", err)
    } finally {
      setRevoking(false)
    }
  }

  const handleRevokeDevice = async () => {
    if (!preparedRevocation) return
    setRevoking(true)
    try {
      await publishPreparedRevocation(preparedRevocation)
      setDeviceToRevoke(null)
    } catch (err) {
      console.error("Failed to revoke device:", err)
    } finally {
      setRevoking(false)
      setPreparedRevocation(null)
      setIsRemovingCurrentDevice(false)
    }
  }

  const closeModal = () => {
    setDeviceToRevoke(null)
    setPreparedRevocation(null)
    setIsRemovingCurrentDevice(false)
  }

  if (registeredDevices.length === 0) {
    return (
      <div className="text-center py-8 text-base-content/60">
        No devices registered yet
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {[...registeredDevices]
        .sort((a, b) => {
          const aIsCurrent = a.identityPubkey === identityPubkey ? -1 : 0
          const bIsCurrent = b.identityPubkey === identityPubkey ? -1 : 0
          return aIsCurrent - bIsCurrent
        })
        .map((device) => {
          const isCurrentDevice = device.identityPubkey === identityPubkey
          const createdDate = new Date(device.createdAt * 1000).toLocaleDateString()

          return (
            <div
              key={device.identityPubkey}
              className="bg-base-200 rounded-lg overflow-hidden"
            >
              <div className="flex items-center gap-3 p-3">
                <RiComputerLine className="w-5 h-5 text-base-content/70" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-mono text-sm truncate min-w-0 w-0 flex-1 block">
                      {device.identityPubkey}
                    </span>
                    {isCurrentDevice && (
                      <span className="badge badge-primary badge-sm shrink-0">
                        This device
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-base-content/60">Added {createdDate}</div>
                </div>
                {isCurrentDevice ? (
                  <div className="flex items-center gap-1">
                    <button
                      onClick={handleRepublishInvite}
                      disabled={republishing}
                      className="btn btn-ghost btn-sm"
                      title="Republish invite event"
                    >
                      <RiRefreshLine
                        className={`w-4 h-4 ${republishing ? "animate-spin" : ""}`}
                      />
                    </button>
                    <button
                      onClick={() => handleRevokeClick(device.identityPubkey, true)}
                      disabled={revoking}
                      className="btn btn-ghost btn-sm text-error"
                      title="Remove this device from messaging"
                    >
                      {revoking && deviceToRevoke === device.identityPubkey ? (
                        <RiLoader4Line className="w-4 h-4 animate-spin" />
                      ) : (
                        <RiDeleteBinLine className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => handleRevokeClick(device.identityPubkey)}
                    disabled={revoking}
                    className="btn btn-ghost btn-sm text-error"
                    title="Revoke device"
                  >
                    {revoking && deviceToRevoke === device.identityPubkey ? (
                      <RiLoader4Line className="w-4 h-4 animate-spin" />
                    ) : (
                      <RiDeleteBinLine className="w-4 h-4" />
                    )}
                  </button>
                )}
              </div>
            </div>
          )
        })}

      <dialog ref={modalRef} className="modal" onClose={closeModal}>
        <div className="modal-box">
          <h3 className="font-bold text-lg flex items-center gap-2">
            <Icon name="warning" size={20} className="text-warning" />
            {isRemovingCurrentDevice
              ? "Remove This Device from Messaging"
              : "Confirm Device Revocation"}
          </h3>
          <div className="py-4">
            <p className="text-sm text-base-content/70 mb-3">
              The following devices will be published to appkeys:
            </p>
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {/* Revoked device - shown with error styling */}
              {deviceToRevoke && (
                <div className="flex items-center gap-2 rounded-lg p-2 bg-error/10 border border-error/30">
                  <RiComputerLine className="w-4 h-4 shrink-0 text-error" />
                  <span className="font-mono text-sm truncate min-w-0 w-0 flex-1 block line-through text-error/70">
                    {deviceToRevoke}
                  </span>
                  <span className="badge badge-error badge-sm ml-auto shrink-0">
                    Removed
                  </span>
                </div>
              )}
              {/* Remaining devices */}
              {preparedRevocation?.devices.map((device) => (
                <div
                  key={device.identityPubkey}
                  className="flex items-center gap-2 rounded-lg p-2 bg-base-200"
                >
                  <RiComputerLine className="w-4 h-4 shrink-0 text-base-content/70" />
                  <span className="font-mono text-sm truncate min-w-0 w-0 flex-1 block">
                    {device.identityPubkey}
                  </span>
                </div>
              ))}
            </div>
          </div>
          <div className="bg-warning/10 border border-warning/30 rounded-lg p-3 text-sm">
            <strong>Warning:</strong> If you&apos;re modifying devices from multiple
            places at the same time, only the most recent change will be kept.
          </div>
          {isRemovingCurrentDevice && (
            <div className="bg-info/10 border border-info/30 rounded-lg p-3 text-sm mt-2">
              After removal, you won&apos;t receive private messages on this device until
              you re-register.
            </div>
          )}
          <div className="modal-action">
            <button className="btn btn-ghost" onClick={closeModal}>
              Cancel
            </button>
            <button
              className="btn btn-error"
              onClick={handleRevokeDevice}
              disabled={revoking}
            >
              {revoking && <RiLoader4Line className="w-4 h-4 animate-spin" />}
              {getButtonText(revoking, isRemovingCurrentDevice)}
            </button>
          </div>
        </div>
        <form method="dialog" className="modal-backdrop">
          <button onClick={closeModal}>close</button>
        </form>
      </dialog>
    </div>
  )
}

export default DeviceList
