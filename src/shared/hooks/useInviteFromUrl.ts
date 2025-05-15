import {Invite, serializeSessionState} from "nostr-double-ratchet/src"
import {useLocalState} from "irisdb-hooks/src/useLocalState"
import {useNavigate, useLocation} from "react-router"
import {NDKEventFromRawEvent} from "@/utils/nostr"
import {hexToBytes} from "@noble/hashes/utils"
import {VerifiedEvent} from "nostr-tools"
import {localState} from "irisdb/src"
import {ndk} from "@/utils/ndk"
import {useEffect} from "react"

export const acceptInvite = async (
  invite: string | Invite,
  myPubKey: string,
  myPrivKey?: string,
  navigate?: (path: string, options?: {state?: Record<string, unknown>}) => void
) => {
  try {
    if (typeof invite === "string") {
      invite = Invite.fromUrl(invite)
    }

    const encrypt = myPrivKey
      ? hexToBytes(myPrivKey)
      : async (plaintext: string, pubkey: string) => {
          if (window.nostr?.nip44) {
            return window.nostr.nip44.encrypt(pubkey, plaintext)
          }
          throw new Error("No nostr extension or private key")
        }

    const {session, event} = await invite.accept(
      (filter, onEvent) => {
        const sub = ndk().subscribe(filter)
        sub.on("event", (e) => onEvent(e as unknown as VerifiedEvent))
        return () => sub.stop()
      },
      myPubKey,
      encrypt
    )

    // Publish the event
    NDKEventFromRawEvent(event).publish()

    // Create session ID in the same format as NewChat
    const sessionId = `${invite.inviter}:${session.name}`

    // Save the session with the new path format
    localState
      .get(`sessions/${sessionId}/state`)
      .put(serializeSessionState(session.state))

    // Navigate to the new chat if navigate function is provided
    if (navigate) {
      navigate(`/chats/chat`, {state: {id: sessionId}})
    }

    return {success: true, inviter: invite.inviter}
  } catch (error) {
    //console.error("Not a valid invite link URL:", error)
    return {success: false, error}
  }
}

export const useInviteFromUrl = () => {
  const navigate = useNavigate()
  const location = useLocation()
  const [myPubKey] = useLocalState("user/publicKey", "")
  const [myPrivKey] = useLocalState("user/privateKey", "")

  useEffect(() => {
    let timeoutId: NodeJS.Timeout | null = null

    // if hash not present, do nothing
    if (!location.hash) {
      return
    }

    if (!myPubKey) {
      timeoutId = setTimeout(() => {
        localState.get("home/showLoginDialog").put(true)
      }, 500)
    } else {
      const acceptInviteFromUrl = async () => {
        const fullUrl = `${window.location.origin}${location.pathname}${location.search}${location.hash}`

        // Clear the invite from URL history by replacing current state with a clean URL
        const cleanUrl = `${window.location.origin}${location.pathname}${location.search}`
        window.history.replaceState({}, document.title, cleanUrl)

        const result = await acceptInvite(fullUrl, myPubKey, myPrivKey, navigate)
        if (!result.success) {
          // Optionally, you can show an error message to the user here
        }
      }

      acceptInviteFromUrl()
    }

    return () => {
      if (timeoutId) {
        clearTimeout(timeoutId)
      }
    }
  }, [location, myPubKey, myPrivKey, navigate])
}
