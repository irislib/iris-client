import {useState} from "react"
import Modal from "@/shared/components/ui/Modal"
import QRScanner from "@/shared/components/QRScanner"
import {useUserStore} from "@/stores/user"
import {useDevicesStore} from "@/stores/devices"
import {
  acceptLinkInvite,
  prepareRegistrationForIdentity,
  publishPreparedRegistration,
} from "@/shared/services/PrivateChats"
import {Invite} from "nostr-double-ratchet/src"

const LINK_INVITE_ROOT = "https://iris.to"

const parseLinkInvite = (input: string, ownerPubkey: string): Invite | null => {
  const trimmed = input.trim()
  if (!trimmed) return null

  const candidates: string[] = []
  if (trimmed.includes("://")) {
    candidates.push(trimmed)
  }
  if (trimmed.startsWith("#")) {
    candidates.push(`${LINK_INVITE_ROOT}${trimmed}`)
  }
  if (!trimmed.includes("://")) {
    const hash = trimmed.startsWith("{") ? encodeURIComponent(trimmed) : trimmed
    candidates.push(`${LINK_INVITE_ROOT}#${hash.replace(/^#/, "")}`)
  }

  for (const url of candidates) {
    try {
      const invite = Invite.fromUrl(url)
      const isLink = invite.purpose === "link" || !!invite.ownerPubkey
      if (!isLink) continue
      if (invite.ownerPubkey && invite.ownerPubkey !== ownerPubkey) {
        continue
      }
      return invite
    } catch {
      // try next
    }
  }

  return null
}

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

  const resetState = () => {
    setLinkInput("")
    setShowScanner(false)
    setStatus("idle")
    setErrorMessage("")
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
    const invite = parseLinkInvite(raw, publicKey)
    if (!invite) {
      setErrorMessage("Invalid link invite")
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

  if (!publicKey || isLinkedDevice) {
    return null
  }

  return (
    <>
      <button className="btn btn-secondary w-full" onClick={openModal}>
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
                  onChange={(e) => setLinkInput(e.target.value)}
                  disabled={status === "accepting"}
                />
                <button
                  className="btn btn-primary"
                  onClick={() => handleAccept(linkInput)}
                  disabled={status === "accepting"}
                >
                  {status === "accepting" ? "Linking..." : "Link Device"}
                </button>
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
