import {useEffect, useRef, useState} from "react"
import Modal from "@/shared/components/ui/Modal"
import QRScanner from "@/shared/components/QRScanner"
import Icon from "@/shared/components/Icons/Icon"
import {useUserStore} from "@/stores/user"
import {useDevicesStore} from "@/stores/devices"
import {parseLinkInviteInput} from "@/shared/utils/linkInvites"
import {
  acceptLinkInvite,
  prepareRegistrationForIdentity,
  publishPreparedRegistration,
} from "@/shared/services/PrivateChats"

const LinkDeviceInvite = () => {
  const publicKey = useUserStore((s) => s.publicKey)
  const isLinkedDevice = useUserStore((s) => s.linkedDevice)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [linkInput, setLinkInput] = useState("")
  const [showScanner, setShowScanner] = useState(false)
  const [status, setStatus] = useState<"idle" | "accepting" | "linked" | "error">(
    "idle"
  )
  const [errorMessage, setErrorMessage] = useState("")
  const lastAutoAttemptRef = useRef<string>("")

  const resetState = () => {
    setLinkInput("")
    setShowScanner(false)
    setStatus("idle")
    setErrorMessage("")
    lastAutoAttemptRef.current = ""
  }

  const closeModal = () => {
    setIsModalOpen(false)
    resetState()
  }

  const openModal = () => {
    if (!publicKey) return
    resetState()
    setIsModalOpen(true)
  }

  const handleAccept = async (raw: string) => {
    if (!publicKey) return
    const invite = parseLinkInviteInput(raw, publicKey)
    if (!invite) {
      setErrorMessage("Invalid link invite")
      setStatus("error")
      return
    }

    setStatus("accepting")
    setErrorMessage("")

    try {
      await acceptLinkInvite(invite)

      const identity = invite.inviter
      const {registeredDevices} = useDevicesStore.getState()
      const alreadyRegistered = registeredDevices.some(
        (d) => d.identityPubkey === identity
      )
      if (!alreadyRegistered) {
        const prepared = await prepareRegistrationForIdentity(identity)
        await publishPreparedRegistration(prepared)
      }

      setStatus("linked")
    } catch (err) {
      setStatus("error")
      setErrorMessage(
        err instanceof Error ? err.message : "Failed to link device"
      )
    }
  }

  const handleScan = (result: string) => {
    setShowScanner(false)
    setLinkInput(result)
    void handleAccept(result)
  }

  useEffect(() => {
    if (!publicKey) return
    if (!linkInput) return
    if (status !== "idle") return
    if (linkInput === lastAutoAttemptRef.current) return

    const invite = parseLinkInviteInput(linkInput, publicKey)
    if (!invite) return

    lastAutoAttemptRef.current = linkInput
    void handleAccept(linkInput)
  }, [linkInput, publicKey, status])

  if (!publicKey || isLinkedDevice) {
    return null
  }

  return (
    <>
      <button
        className="btn btn-secondary w-full flex items-center justify-center gap-2"
        onClick={openModal}
      >
        <Icon name="qr" size={16} />
        Link another device
      </button>
      {isModalOpen && (
        <Modal onClose={closeModal}>
          <div className="flex flex-col items-center gap-4 p-2 max-w-[360px] mx-auto">
            <h3 className="text-lg font-semibold">Link another device</h3>
            <p className="text-sm text-base-content/70 text-center">
              Paste or scan the link from your new device to connect it.
            </p>

            {showScanner ? (
              <div className="w-full flex flex-col gap-3">
                <div className="aspect-square w-full rounded-lg overflow-hidden bg-base-200">
                  <QRScanner onScanSuccess={handleScan} />
                </div>
                <button className="btn btn-ghost" onClick={() => setShowScanner(false)}>
                  Paste link instead
                </button>
              </div>
            ) : (
              <div className="w-full flex flex-col gap-3">
                <input
                  type="text"
                  className="input input-bordered w-full text-center"
                  placeholder="Paste link invite"
                  value={linkInput}
                  onChange={(e) => {
                    setLinkInput(e.target.value)
                    if (status === "error") {
                      setStatus("idle")
                      setErrorMessage("")
                    }
                  }}
                  disabled={status === "accepting"}
                />
                {status === "accepting" && (
                  <div className="text-sm text-base-content/70 text-center">
                    Linking...
                  </div>
                )}
                <button className="btn btn-ghost" onClick={() => setShowScanner(true)}>
                  Scan QR code
                </button>
              </div>
            )}

            {status === "linked" && <div className="text-sm text-success">Device linked</div>}
            {status === "error" && <div className="text-sm text-error">{errorMessage}</div>}
            <button className="btn btn-ghost w-full" onClick={closeModal}>
              Close
            </button>
          </div>
        </Modal>
      )}
    </>
  )
}

export default LinkDeviceInvite
