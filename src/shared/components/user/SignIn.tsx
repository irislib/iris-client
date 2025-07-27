import {hexToBytes, bytesToHex} from "@noble/hashes/utils"
import {ChangeEvent, useEffect, useState} from "react"
import {getPublicKey, nip19} from "nostr-tools"
import {useUserStore} from "@/stores/user"
import {useUIStore} from "@/stores/ui"
import classNames from "classnames"

const NSEC_NPUB_REGEX = /(nsec1|npub1)[a-zA-Z0-9]{20,65}/gi
const HEX_REGEX = /[0-9a-fA-F]{64}/gi

interface SignInProps {
  onClose: () => void
}

export default function SignIn({onClose}: SignInProps) {
  const {setNip07Login, setPublicKey, setPrivateKey} = useUserStore()
  const setShowLoginDialog = useUIStore((state) => state.setShowLoginDialog)
  const [inputPrivateKey, setInputPrivateKey] = useState("")

  useEffect(() => {
    if (
      inputPrivateKey &&
      (inputPrivateKey.match(NSEC_NPUB_REGEX) || inputPrivateKey.match(HEX_REGEX))
    ) {
      if (inputPrivateKey && typeof inputPrivateKey === "string") {
        const bytes =
          inputPrivateKey.indexOf("nsec1") === 0
            ? (nip19.decode(inputPrivateKey).data as Uint8Array)
            : hexToBytes(inputPrivateKey)
        const hex = bytesToHex(bytes)
        const publicKey = getPublicKey(bytes)
        setPrivateKey(hex)
        setPublicKey(publicKey)
        localStorage.setItem("cashu.ndk.privateKeySignerPrivateKey", hex)
        localStorage.setItem("cashu.ndk.pubkey", publicKey)
        setShowLoginDialog(false)
        onClose()
      }
    }
  }, [inputPrivateKey, setPrivateKey, setPublicKey, onClose, setShowLoginDialog])

  async function extensionLogin() {
    if (window.nostr) {
      try {
        const publicKey = await window.nostr.getPublicKey()
        setPublicKey(publicKey)
        setNip07Login(true)
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
          className={classNames("input input-bordered", {
            "input-error": inputPrivateKey && inputPrivateKey.length < 60,
          })}
          placeholder="Paste secret key"
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
    </div>
  )
}
