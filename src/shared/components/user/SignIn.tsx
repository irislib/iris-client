import {hexToBytes, bytesToHex} from "@noble/hashes/utils.js"
import {SecretKeySigner} from "@/lib/nostr"
import {ChangeEvent, useEffect, useRef, useState} from "react"
import {getPublicKey, nip19} from "nostr-tools"
import {useUserStore} from "@/stores/user"
import {useUIStore} from "@/stores/ui"
import classNames from "classnames"
import {nostr} from "@/utils/nostrClient"
import {NSEC_NPUB_REGEX, HEX_REGEX} from "@/utils/validation"

interface SignInProps {
  onClose: () => void
}

export default function SignIn({onClose}: SignInProps) {
  const setShowLoginDialog = useUIStore((state) => state.setShowLoginDialog)
  const [inputPrivateKey, setInputPrivateKey] = useState("")

  const [signerPending, setSignerPending] = useState(false)
  const [signerError, setSignerError] = useState("")

  const pairing = useRef<AbortController | null>(null)
  useEffect(() => () => pairing.current?.abort(), [])

  async function remoteLogin() {
    if (pairing.current) return
    const controller = new AbortController()
    pairing.current = controller
    setSignerPending(true)
    setSignerError("")
    try {
      const {requestBrowserSigner} = await import("@iris/identity/browserSigner")
      const session = await requestBrowserSigner({
        name: CONFIG.appName,
        signal: controller.signal,
        permissions: "sign_event,nip44_encrypt,nip44_decrypt",
      })
      if (!session || controller.signal.aborted) return
      localStorage.removeItem("cashu.ndk.privateKeySignerPrivateKey")
      localStorage.setItem("cashu.ndk.pubkey", session.pubkey)
      useUserStore.setState({
        publicKey: session.pubkey,
        privateKey: "",
        remoteSigner: session,
        nip07Login: false,
        linkedDevice: false,
      })
      setShowLoginDialog(false)
      onClose()
    } catch {
      setSignerError("Could not connect to your signer. Please try again.")
    } finally {
      pairing.current = null
      setSignerPending(false)
    }
  }

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
          useUserStore.setState({
            publicKey,
            privateKey: "",
            remoteSigner: null,
            nip07Login: false,
            linkedDevice: false,
          })
          setShowLoginDialog(false)
          onClose()
        }
        // Handle nsec (private key)
        else if (inputPrivateKey.indexOf("nsec1") === 0) {
          const bytes = nip19.decode(inputPrivateKey).data as Uint8Array
          const hex = bytesToHex(bytes)
          const privateKeySigner = new SecretKeySigner(hex)
          nostr().signer = privateKeySigner
          const publicKey = getPublicKey(bytes)

          useUserStore.setState({
            privateKey: hex,
            publicKey,
            remoteSigner: null,
            nip07Login: false,
            linkedDevice: false,
          })
          localStorage.setItem("cashu.ndk.privateKeySignerPrivateKey", hex)
          localStorage.setItem("cashu.ndk.pubkey", publicKey)
          setShowLoginDialog(false)
          onClose()
        }
        // Handle hex (assume private key)
        else if (inputPrivateKey.match(HEX_REGEX)) {
          const bytes = hexToBytes(inputPrivateKey)
          const hex = bytesToHex(bytes)
          const privateKeySigner = new SecretKeySigner(hex)
          nostr().signer = privateKeySigner
          const publicKey = getPublicKey(bytes)

          useUserStore.setState({
            privateKey: hex,
            publicKey,
            remoteSigner: null,
            nip07Login: false,
            linkedDevice: false,
          })
          localStorage.setItem("cashu.ndk.privateKeySignerPrivateKey", hex)
          localStorage.setItem("cashu.ndk.pubkey", publicKey)
          setShowLoginDialog(false)
          onClose()
        }
      }
    }
  }, [inputPrivateKey, onClose, setShowLoginDialog])

  async function extensionLogin() {
    setSignerError("")
    if (!window.nostr) {
      setSignerError(
        "Connect a Nostr extension to this tab, then try again. In Nostr Backup, unlock your signer in Account first."
      )
      return
    }
    try {
      const publicKey = await window.nostr.getPublicKey()
      useUserStore.setState({
        publicKey,
        privateKey: "",
        remoteSigner: null,
        nip07Login: true,
        linkedDevice: false,
      })
      setShowLoginDialog(false)
      onClose()
    } catch (error) {
      setSignerError(
        error instanceof Error ? error.message : "Extension login was declined."
      )
    }
  }

  function onPrivateKeyChange(e: ChangeEvent<HTMLInputElement>) {
    setInputPrivateKey(e.target.value)
  }

  return (
    <div className="flex flex-col gap-4">
      <form
        className="flex flex-col items-center gap-4 flex-wrap"
        onSubmit={(e) => e.preventDefault()}
      >
        <h1 className="text-2xl font-bold">Sign in</h1>
        <button
          type="button"
          className="btn btn-neutral"
          disabled={signerPending}
          onClick={remoteLogin}
        >
          Sign in with remote signer
        </button>
        {signerError && <div role="alert">{signerError}</div>}
        <button type="button" className="btn btn-primary" onClick={extensionLogin}>
          Nostr Extension Login
        </button>
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
    </div>
  )
}
