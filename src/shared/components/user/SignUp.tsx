import {ChangeEvent, KeyboardEvent, useEffect, useRef, useState} from "react"
import {generateSecretKey, getPublicKey, nip19} from "nostr-tools"
import {NDKEvent, NDKPrivateKeySigner} from "@nostr-dev-kit/ndk"
import {useLocalState} from "irisdb-hooks/src/useLocalState"
import {bytesToHex} from "@noble/hashes/utils"
import {localState} from "irisdb/src"
import {ndk} from "@/utils/ndk"
import {useUserStore} from "@/stores/user"

const NSEC_NPUB_REGEX = /(nsec1|npub1)[a-zA-Z0-9]{20,65}/gi

interface SignUpProps {
  onClose: () => void
}

export default function SignUp({onClose}: SignUpProps) {
  const [newUserName, setNewUserName] = useState("")
  const [, setShowLoginDialog] = useLocalState("home/showLoginDialog", false)
  const inputRef = useRef<HTMLInputElement>(null)
  const setPublicKey = useUserStore((state) => state.setPublicKey)
  const setPrivateKey = useUserStore((state) => state.setPrivateKey)
  const setWalletConnect = useUserStore((state) => state.setWalletConnect)
  const setCashuEnabled = useUserStore((state) => state.setCashuEnabled)

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.focus()
    }
  }, [inputRef.current])

  function onNameChange(e: ChangeEvent<HTMLInputElement>) {
    const val = e.target.value
    if (val.match(NSEC_NPUB_REGEX)) {
      e.preventDefault()
    } else {
      setNewUserName(e.target.value)
    }
  }

  function handleKeyDown(e: KeyboardEvent<HTMLFormElement>) {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      handleSubmit(true)
    }
  }

  function handleSubmit(ctrlPressed = false) {
    ndk()
    const sk = generateSecretKey()
    const pk = getPublicKey(sk)
    const npub = nip19.npubEncode(pk)
    const privateKeyHex = bytesToHex(sk)
    
    // Update user store directly
    setPrivateKey(privateKeyHex)
    setPublicKey(pk)
    setCashuEnabled(true)
    setWalletConnect(true)
    
    // Keep these for backward compatibility
    localStorage.setItem("cashu.ndk.privateKeySignerPrivateKey", privateKeyHex)
    localStorage.setItem("cashu.ndk.pubkey", pk)
    const privateKeySigner = new NDKPrivateKeySigner(privateKeyHex)
    ndk().signer = privateKeySigner

    const incognito = ctrlPressed && newUserName.trim() === ""
    if (!incognito) {
      const profileEvent = new NDKEvent(ndk())
      profileEvent.kind = 0
      profileEvent.content = JSON.stringify({
        display_name: newUserName.trim(),
        lud16: `${npub}@npub.cash`,
      })
      profileEvent.publish()
    }

    setShowLoginDialog(false)
  }

  return (
    <div className="flex flex-col gap-4">
      <form
        className="flex flex-col items-center gap-4 flex-wrap"
        onSubmit={(e) => {
          e.preventDefault()
          handleSubmit()
        }}
        onKeyDown={handleKeyDown}
      >
        <h1 className="text-2xl font-bold">Sign up</h1>
        <input
          ref={inputRef}
          autoComplete="name"
          autoFocus
          className="input input-bordered"
          type="text"
          placeholder="What's your name?"
          value={newUserName}
          onChange={(e) => onNameChange(e)}
        />
        <button className="btn btn-primary" type="submit">
          Go
        </button>
      </form>
      <div
        className="flex flex-col items-center justify-center gap-4 flex-wrap border-t pt-4 cursor-pointer"
        onClick={onClose}
      >
        <span className="hover:underline">Already have an account?</span>
        <button className="btn btn-sm btn-neutral">Sign in</button>
      </div>
    </div>
  )
}
