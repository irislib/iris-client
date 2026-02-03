import {useState, useRef, useEffect} from "react"
import {useDevicesStore} from "@/stores/devices"
import {
  prepareRegistration,
  publishPreparedRegistration,
  PreparedRegistration,
} from "@/shared/services/PrivateChats"
import {RiAddLine, RiComputerLine} from "@remixicon/react"
import {createDebugLogger} from "@/utils/createDebugLogger"
import {DEBUG_NAMESPACES, MAX_DR_DEVICES} from "@/utils/constants"
import Icon from "@/shared/components/Icons/Icon"

const {error} = createDebugLogger(DEBUG_NAMESPACES.UTILS)

const RegisterDevice = () => {
  const {isCurrentDeviceRegistered, registeredDevices} = useDevicesStore()
  const [isRegistering, setIsRegistering] = useState(false)
  const isAtLimit = registeredDevices.length >= MAX_DR_DEVICES
  const [showConfirmModal, setShowConfirmModal] = useState(false)
  const [preparedRegistration, setPreparedRegistration] =
    useState<PreparedRegistration | null>(null)
  const modalRef = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    if (showConfirmModal) {
      modalRef.current?.showModal()
    } else {
      modalRef.current?.close()
    }
  }, [showConfirmModal])

  const handleRegisterClick = async () => {
    // If there are other devices, prepare first then show confirmation modal
    if (registeredDevices.length > 0) {
      setIsRegistering(true)
      try {
        const prepared = await prepareRegistration()
        setPreparedRegistration(prepared)
        setShowConfirmModal(true)
      } catch (err) {
        error("Failed to prepare registration:", err)
      } finally {
        setIsRegistering(false)
      }
    } else {
      // No confirmation needed - prepare and publish immediately
      handleRegister()
    }
  }

  const handleRegister = async () => {
    setShowConfirmModal(false)
    setIsRegistering(true)
    try {
      if (preparedRegistration) {
        await publishPreparedRegistration(preparedRegistration)
      } else {
        // First device - prepare and publish in one step
        const prepared = await prepareRegistration()
        await publishPreparedRegistration(prepared)
      }
      
    } catch (err) {
      error("Failed to register device:", err)
    } finally {
      setIsRegistering(false)
      setPreparedRegistration(null)
    }
  }

  if (isCurrentDeviceRegistered) {
    return null
  }

  return (
    <>
      <button
        className="btn btn-primary w-full gap-2"
        onClick={handleRegisterClick}
        disabled={isRegistering || isAtLimit}
      >
        {isRegistering ? (
          <span className="loading loading-spinner loading-sm" />
        ) : (
          <RiAddLine className="w-5 h-5" />
        )}
        Register this device
      </button>
      {isAtLimit && (
        <p className="text-sm text-warning mt-2">
          Maximum of {MAX_DR_DEVICES} devices reached. Revoke an existing device to
          register this one.
        </p>
      )}

      <dialog ref={modalRef} className="modal" onClose={() => setShowConfirmModal(false)}>
        <div className="modal-box">
          <h3 className="font-bold text-lg flex items-center gap-2">
            <Icon name="warning" size={20} className="text-warning" />
            Confirm Device Registration
          </h3>
          <div className="py-4">
            <p className="text-sm text-base-content/70 mb-3">
              The following devices will be published to appkeys:
            </p>
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {preparedRegistration?.devices.map((device) => {
                const isNewDevice =
                  device.identityPubkey === preparedRegistration.newDeviceIdentity
                return (
                  <div
                    key={device.identityPubkey}
                    className={`flex items-center gap-2 rounded-lg p-2 ${
                      isNewDevice
                        ? "bg-primary/10 border border-primary/30"
                        : "bg-base-200"
                    }`}
                  >
                    <RiComputerLine
                      className={`w-4 h-4 shrink-0 ${
                        isNewDevice ? "text-primary" : "text-base-content/70"
                      }`}
                    />
                    <span className="font-mono text-sm truncate min-w-0 w-0 flex-1 block">
                      {device.identityPubkey}
                    </span>
                    {isNewDevice && (
                      <span className="badge badge-primary badge-sm ml-auto shrink-0">
                        New
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
          <div className="bg-warning/10 border border-warning/30 rounded-lg p-3 text-sm">
            <strong>Warning:</strong> If you&apos;re adding devices from multiple places
            at the same time, only the most recent change will be kept. Make sure no other
            device is currently being registered.
          </div>
          <div className="modal-action">
            <button className="btn btn-ghost" onClick={() => setShowConfirmModal(false)}>
              Cancel
            </button>
            <button className="btn btn-primary" onClick={handleRegister}>
              Register Device
            </button>
          </div>
        </div>
        <form method="dialog" className="modal-backdrop">
          <button onClick={() => setShowConfirmModal(false)}>close</button>
        </form>
      </dialog>
    </>
  )
}

export default RegisterDevice
