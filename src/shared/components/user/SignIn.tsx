import {hexToBytes, bytesToHex} from "@noble/hashes/utils"
import {NDKPrivateKeySigner} from "@/lib/ndk"
import {ChangeEvent, useEffect, useState} from "react"
import {getPublicKey, nip19} from "nostr-tools"
import {useUserStore} from "@/stores/user"
import {useUIStore} from "@/stores/ui"
import classNames from "classnames"
import {ndk} from "@/utils/ndk"
import {NSEC_NPUB_REGEX, HEX_REGEX} from "@/utils/validation"
import Icon from "@/shared/components/Icons/Icon"

interface SignInProps {
  onClose: () => void
  onLink?: () => void
}

export default function SignIn({onClose, onLink}: SignInProps) {
  const {setNip07Login, setPublicKey, setPrivateKey, setLinkedDevice} = useUserStore()
  const setShowLoginDialog = useUIStore((state) => state.setShowLoginDialog)
  const [inputPrivateKey, setInputPrivateKey] = useState("")

  useEffect(() => {
    if (
      inputPrivateKey &&
      (inputPrivateKey.match(NSEC_NPUB_REGEX) || inputPrivateKey.match(HEX_REGEX))
    ) {
      if (inputPrivateKey && typeof inputPrivateKey === "string") {
        // Handle npub (public key only - view mode)
        if (inputPrivateKey.indexOf("npub1") === 0) {
          const decoded = nip19.decode(inputPrivateKey)
          const publicKey = decoded.data as string
          setPublicKey(publicKey)
          setPrivateKey("") // No private key for view-only mode
          setLinkedDevice(false)
          setShowLoginDialog(false)
          onClose()
        }
        // Handle nsec (private key)
        else if (inputPrivateKey.indexOf("nsec1") === 0) {
          const bytes = nip19.decode(inputPrivateKey).data as Uint8Array
          const hex = bytesToHex(bytes)
          const privateKeySigner = new NDKPrivateKeySigner(hex)
          ndk().signer = privateKeySigner
          const publicKey = getPublicKey(bytes)
          setPrivateKey(hex)
          setPublicKey(publicKey)
          setLinkedDevice(false)
          localStorage.setItem("cashu.ndk.privateKeySignerPrivateKey", hex)
          localStorage.setItem("cashu.ndk.pubkey", publicKey)
          setShowLoginDialog(false)
          onClose()
        }
        // Handle hex (assume private key)
        else if (inputPrivateKey.match(HEX_REGEX)) {
          const bytes = hexToBytes(inputPrivateKey)
          const hex = bytesToHex(bytes)
          const privateKeySigner = new NDKPrivateKeySigner(hex)
          ndk().signer = privateKeySigner
          const publicKey = getPublicKey(bytes)
          setPrivateKey(hex)
          setPublicKey(publicKey)
          setLinkedDevice(false)
          localStorage.setItem("cashu.ndk.privateKeySignerPrivateKey", hex)
          localStorage.setItem("cashu.ndk.pubkey", publicKey)
          setShowLoginDialog(false)
          onClose()
        }
      }
    }
  }, [inputPrivateKey, setPrivateKey, setPublicKey, onClose, setShowLoginDialog])

  async function extensionLogin() {
    if (window.nostr) {
      try {
        const publicKey = await window.nostr.getPublicKey()
        setPublicKey(publicKey)
        setNip07Login(true)
        setLinkedDevice(false)
        setShowLoginDialog(false)
        onClose()
      } catch (error) {
        console.error("Error getting public key from NIP-07 extension:", error)
      }
    } else {
      window.open("https://nostrcheck.me/register/browser-extension.php", "_blank")
    }
  }

  function onPrivateKeyChange(e: ChangeEvent<HTMLInputElement>) {
    setInputPrivateKey(e.target.value)
  }

  function isElectronRenderer() {
    return navigator.userAgent.toLowerCase().includes("electron")
  }

  return (
    <div className="flex flex-col gap-4">
      <form
        className="flex flex-col items-center gap-4 flex-wrap"
        onSubmit={(e) => e.preventDefault()}
      >
        <h1 className="text-2xl font-bold">Sign in</h1>
        {!isElectronRenderer() && (
          <>
            <button className="btn btn-primary" onClick={() => extensionLogin()}>
              {window.nostr ? "Nostr Extension Login" : "Install Nostr Extension"}
            </button>
            or
          </>
        )}
        <input
          autoComplete="nsec"
          type="password"
          className={classNames(
            "input input-bordered w-full min-w-[280px] max-w-[90vw] text-center",
            {
              "input-error": inputPrivateKey && inputPrivateKey.length < 60,
            }
          )}
          placeholder="Paste secret or public key"
          onChange={(e) => onPrivateKeyChange(e)}
        />
      </form>
      <div
        className="flex flex-col items-center justify-center gap-4 flex-wrap border-t pt-4 cursor-pointer"
        onClick={onClose}
      >
        <span className="hover:underline">Don&apos;t have an account?</span>
        <button className="btn btn-sm btn-neutral">Sign up</button>
      </div>
      {onLink && (
        <button
          className="btn btn-sm btn-ghost w-full flex items-center justify-center gap-2"
          onClick={onLink}
        >
          <Icon name="qr" size={16} />
          Link this device
        </button>
      )}
    </div>
  )
}
