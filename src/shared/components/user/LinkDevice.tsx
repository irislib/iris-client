import {useEffect, useRef, useState} from "react"
import {useUserStore} from "@/stores/user"
import {useUIStore} from "@/stores/ui"
import {
  createLinkInvite,
  buildLinkInviteUrl,
  listenForLinkInviteAcceptance,
} from "@/shared/services/PrivateChats"
import {ndk} from "@/utils/ndk"
import Icon from "@/shared/components/Icons/Icon"

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

const truncateMiddle = (value: string, maxLength: number) => {
  if (value.length <= maxLength) return value
  const half = Math.floor((maxLength - 3) / 2)
  return `${value.slice(0, half)}...${value.slice(-half)}`
}

export default function LinkDevice({onBack}: LinkDeviceProps) {
  const setShowLoginDialog = useUIStore((state) => state.setShowLoginDialog)
  const {setPublicKey, setPrivateKey, setNip07Login, setLinkedDevice} = useUserStore()
  const [error, setError] = useState("")
  const [inviteUrl, setInviteUrl] = useState("")
  const [qrCodeUrl, setQrCodeUrl] = useState("")
  const [copied, setCopied] = useState(false)
  const [status, setStatus] = useState<"idle" | "waiting" | "linked" | "error">(
    "idle"
  )
  const unsubscribeRef = useRef<(() => void) | null>(null)
  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    let active = true

    const start = async () => {
      setStatus("waiting")
      setError("")

      try {
        const invite = await createLinkInvite()
        if (!active) return

        const url = buildLinkInviteUrl(invite, getInviteBaseUrl())
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

  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current) {
        clearTimeout(copyTimeoutRef.current)
      }
    }
  }, [])

  const handleCopy = async () => {
    if (!inviteUrl) return
    await navigator.clipboard.writeText(inviteUrl)
    setCopied(true)
    if (copyTimeoutRef.current) {
      clearTimeout(copyTimeoutRef.current)
    }
    copyTimeoutRef.current = setTimeout(() => setCopied(false), 2000)
  }

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
        <button
          type="button"
          className="btn btn-neutral w-full max-w-full flex items-center justify-center gap-2 text-sm py-2 font-mono relative overflow-hidden min-w-0"
          onClick={handleCopy}
          title={inviteUrl}
          data-testid="link-invite-copy"
        >
          <span
            className={`absolute inset-0 flex items-center justify-center gap-2 max-w-full min-w-0 transition-opacity ${
              copied ? "opacity-100" : "opacity-0 pointer-events-none"
            }`}
          >
            <Icon name="check" size={16} />
            <span className="truncate min-w-0">Copied</span>
          </span>
          <span
            className={`flex items-center justify-center gap-2 w-full max-w-full min-w-0 transition-opacity ${
              copied ? "opacity-0" : "opacity-100"
            }`}
          >
            <Icon name="copy" size={16} />
            <span className="truncate min-w-0 flex-1">
              {truncateMiddle(inviteUrl, 32)}
            </span>
          </span>
        </button>
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
