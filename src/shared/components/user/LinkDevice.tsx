import {useEffect, useRef, useState} from "react"
import {useUserStore} from "@/stores/user"
import {useUIStore} from "@/stores/ui"
import {
  createLinkInvite,
  listenForLinkInviteAcceptance,
} from "@/shared/services/PrivateChats"
import {ndk} from "@/utils/ndk"
import CopyButton from "@/shared/components/button/CopyButton"

interface LinkDeviceProps {
  onBack: () => void
}

const getInviteBaseUrl = (): string => {
  const origin = window.location.origin
  if (
    origin.startsWith("tauri://") ||
    origin.startsWith("http://localhost") ||
    origin.startsWith("http://127.0.0.1")
  ) {
    return "https://iris.to"
  }
  return origin
}

export default function LinkDevice({onBack}: LinkDeviceProps) {
  const setShowLoginDialog = useUIStore((state) => state.setShowLoginDialog)
  const {setPublicKey, setPrivateKey, setNip07Login, setLinkedDevice} = useUserStore()
  const [error, setError] = useState("")
  const [inviteUrl, setInviteUrl] = useState("")
  const [qrCodeUrl, setQrCodeUrl] = useState("")
  const [status, setStatus] = useState<"idle" | "waiting" | "linked" | "error">(
    "idle"
  )
  const unsubscribeRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    let active = true

    const start = async () => {
      setStatus("waiting")
      setError("")

      try {
        const invite = await createLinkInvite()
        if (!active) return

        const url = invite.getUrl(getInviteBaseUrl())
        setInviteUrl(url)

        unsubscribeRef.current = listenForLinkInviteAcceptance(
          invite,
          async (ownerPubkey) => {
            try {
              ndk().signer = undefined
              setPublicKey(ownerPubkey)
              setPrivateKey("")
              setNip07Login(false)
              setLinkedDevice(true)

              localStorage.removeItem("cashu.ndk.privateKeySignerPrivateKey")
              localStorage.removeItem("cashu.ndk.pubkey")

              if (window.location.hash) {
                history.replaceState(null, "", window.location.pathname)
              }

              setStatus("linked")
              setShowLoginDialog(false)
            } catch (err) {
              setStatus("error")
              setError(
                err instanceof Error ? err.message : "Failed to link device"
              )
            } finally {
              unsubscribeRef.current?.()
              unsubscribeRef.current = null
            }
          }
        )
      } catch (err) {
        setStatus("error")
        setError(err instanceof Error ? err.message : "Failed to create link invite")
      }
    }

    start()

    return () => {
      active = false
      unsubscribeRef.current?.()
      unsubscribeRef.current = null
    }
  }, [setLinkedDevice, setNip07Login, setPrivateKey, setPublicKey, setShowLoginDialog])

  useEffect(() => {
    if (!inviteUrl) return
    const generateQR = async () => {
      try {
        const QRCode = await import("qrcode")
        const url = await new Promise<string>((resolve, reject) => {
          QRCode.toDataURL(inviteUrl, (err, data) => {
            if (err) reject(err)
            else resolve(data)
          })
        })
        setQrCodeUrl(url)
      } catch (err) {
        setError("Failed to generate QR code")
      }
    }
    generateQR()
  }, [inviteUrl])

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col items-center gap-2">
        <h1 className="text-2xl font-bold">Link this device</h1>
        <p className="text-sm text-base-content/70 text-center">
          Scan this code with your main device to connect it.
        </p>
      </div>

      <div className="bg-white rounded-xl p-3 mx-auto">
        {qrCodeUrl ? (
          <img src={qrCodeUrl} alt="Link invite QR code" className="w-56 h-56" />
        ) : (
          <div className="w-56 h-56 bg-base-200 animate-pulse rounded-lg" />
        )}
      </div>

      {inviteUrl && (
        <div className="flex flex-col gap-2">
          <CopyButton className="btn btn-neutral w-full" copyStr={inviteUrl} text="Copy link" />
          <p className="text-xs text-base-content/60 break-all text-center">
            {inviteUrl}
          </p>
        </div>
      )}

      {status === "waiting" && (
        <div className="text-sm text-base-content/70 text-center">
          Waiting for approval…
        </div>
      )}
      {status === "linked" && (
        <div className="text-sm text-success text-center">Device linked</div>
      )}
      {status === "error" && (
        <div className="text-sm text-error text-center">{error}</div>
      )}

      <button className="btn btn-ghost" onClick={onBack}>
        Back to sign in
      </button>
    </div>
  )
}
