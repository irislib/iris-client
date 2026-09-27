import {useState, useRef, useEffect, useId} from "react"
import {useDevicesStore} from "@/stores/devices"
import {useUserStore} from "@/stores/user"
import {
  prepareRegistration,
  publishPreparedRegistration,
  PreparedRegistration,
} from "@/shared/services/PrivateChats"
import {RiAddLine, RiComputerLine} from "@remixicon/react"
import {createDebugLogger} from "@/utils/createDebugLogger"
import {DEBUG_NAMESPACES} from "@/utils/constants"
import {
  describeManagedDevice,
  getStoredManagedDeviceLabels,
} from "@/shared/services/deviceLabels"

const {error} = createDebugLogger(DEBUG_NAMESPACES.UTILS)

const RegisterDevice = () => {
  const {isCurrentDeviceRegistered} = useDevicesStore()
  const isLinkedDevice = useUserStore((s) => s.linkedDevice)
  const [isRegistering, setIsRegistering] = useState(false)
  const [registrationError, setRegistrationError] = useState("")
  const [showConfirmModal, setShowConfirmModal] = useState(false)
  const [preparedRegistration, setPreparedRegistration] =
    useState<PreparedRegistration | null>(null)
  const modalRef = useRef<HTMLDialogElement>(null)
  const modalTitleId = useId()

  useEffect(() => {
    if (showConfirmModal) {
      modalRef.current?.showModal()
    } else {
      modalRef.current?.close()
    }
  }, [showConfirmModal])

  const handleRegisterClick = async () => {
    setRegistrationError("")
    setIsRegistering(true)
    try {
      const prepared = await prepareRegistration()
      // Use the freshly fetched roster, which may include devices not yet cached.
      if (prepared.baseDevices.length > 0) {
        setPreparedRegistration(prepared)
        setShowConfirmModal(true)
      } else {
        await publishPreparedRegistration(prepared)
      }
    } catch (err) {
      error("Failed to register device:", err)
      setRegistrationError("Couldn’t register this device. Please try again.")
    } finally {
      setIsRegistering(false)
    }
  }

  const handleRegister = async () => {
    if (!preparedRegistration) return
    setShowConfirmModal(false)
    setRegistrationError("")
    setIsRegistering(true)
    try {
      await publishPreparedRegistration(preparedRegistration)
    } catch (err) {
      error("Failed to register device:", err)
      setRegistrationError("Couldn’t register this device. Please try again.")
    } finally {
      setIsRegistering(false)
      setPreparedRegistration(null)
    }
  }

  if (isCurrentDeviceRegistered || isLinkedDevice) {
    return null
  }

  return (
    <>
      <button
        className="btn btn-primary w-full gap-2"
        onClick={handleRegisterClick}
        disabled={isRegistering}
      >
        {isRegistering ? (
          <span className="loading loading-spinner loading-sm" />
        ) : (
          <RiAddLine className="w-5 h-5" />
        )}
        {isRegistering ? "Registering…" : "Register this device"}
      </button>
      {registrationError && (
        <p role="alert" className="text-sm text-error mt-3">
          {registrationError}
        </p>
      )}
      <dialog
        ref={modalRef}
        className="modal text-left"
        aria-labelledby={modalTitleId}
        onClose={() => {
          setShowConfirmModal(false)
          setPreparedRegistration(null)
        }}
      >
        <div className="modal-box">
          <h3 id={modalTitleId} className="font-bold text-lg">
            Register this device?
          </h3>
          <div className="py-4">
            <p className="text-sm text-base-content/70 mb-3">
              This device will be able to send and receive encrypted messages alongside
              your other devices.
            </p>
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {preparedRegistration?.devices.map((device) => {
                const isNewDevice =
                  device.identityPubkey === preparedRegistration.newDeviceIdentity
                const display = describeManagedDevice(
                  device.identityPubkey,
                  getStoredManagedDeviceLabels(
                    device.identityPubkey,
                    preparedRegistration.appKeys
                  )
                )
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
                    <div className="min-w-0 w-0 flex-1">
                      <span className="font-mono text-sm truncate block">
                        {display.title}
                      </span>
                      {display.subtitle && (
                        <span className="text-xs text-base-content/60 truncate block">
                          {display.subtitle}
                        </span>
                      )}
                    </div>
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
          <p className="text-sm text-base-content/70">
            Add devices one at a time so each registration is saved.
          </p>
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
