import {ChangeEvent, KeyboardEvent, useEffect, useRef, useState} from "react"
import {generateSecretKey, getPublicKey, nip19, EventTemplate} from "nostr-tools"
import {bytesToHex} from "@noble/hashes/utils"
import {useUserStore} from "@/stores/user"
import {useUIStore} from "@/stores/ui"
import {publishEvent} from "@/utils/applesauce"
import {addCachedProfile} from "@/utils/profileCache"
import {handleProfile} from "@/utils/profileSearch"
import {addDoubleRatchetUser} from "@/pages/chats/utils/doubleRatchetUsers"
import {useSessionsStore} from "@/stores/sessions"

const NSEC_NPUB_REGEX = /(nsec1|npub1)[a-zA-Z0-9]{20,65}/gi

interface SignUpProps {
  onClose: () => void
}

export default function SignUp({onClose}: SignUpProps) {
  const [newUserName, setNewUserName] = useState("")
  const {setShowLoginDialog} = useUIStore()
  const inputRef = useRef<HTMLInputElement>(null)
  const setState = useUserStore.setState

  useEffect(() => {
    if (inputRef.current) {
      setTimeout(() => {
        inputRef.current?.focus()
      })
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

  async function handleSubmit(ctrlPressed = false) {
    const sk = generateSecretKey()
    const pk = getPublicKey(sk)
    const npub = nip19.npubEncode(pk)
    const privateKeyHex = bytesToHex(sk)

    // Update user store directly
    setState({
      privateKey: privateKeyHex,
      publicKey: pk,
      cashuEnabled: true,
      walletConnect: true,
    })

    // Keep these for backward compatibility
    localStorage.setItem("cashu.ndk.privateKeySignerPrivateKey", privateKeyHex)
    localStorage.setItem("cashu.ndk.pubkey", pk)

    // Note: watchUserSettings() will automatically update the signer when privateKey changes

    // Close dialog immediately after setting up the user
    setShowLoginDialog(false)

    // Publish profile in background (non-blocking)
    const incognito = ctrlPressed && newUserName.trim() === ""
    if (!incognito) {
      const profileData = {
        display_name: newUserName.trim(),
        lud16: `${npub}@npub.cash`,
        created_at: Math.floor(Date.now() / 1000),
      }

      const template: EventTemplate = {
        kind: 0,
        created_at: Math.floor(Date.now() / 1000),
        tags: [],
        content: JSON.stringify(profileData),
      }

      // Immediately update the profile cache so the name shows up
      addCachedProfile(pk, profileData)
      handleProfile(pk, profileData)

      // Add the user to their own double ratchet list for testing purposes
      addDoubleRatchetUser(pk)

      // Create default invites for double-ratchet messaging
      try {
        useSessionsStore.getState().createDefaultInvites()
      } catch (error) {
        console.error("Failed to create default invites:", error)
      }

      publishEvent(template)
        .then(() => console.log("Profile published successfully for new user"))
        .catch((error) => console.error("Failed to publish profile event:", error))
    }
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
