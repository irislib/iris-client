import {useState} from "react"
import {nip19} from "nostr-tools"
import {useNavigate} from "@/navigation"
import {useUserStore} from "@/stores/user"
import {acceptChatInvite} from "@/shared/services/PrivateChats"
import {parseChatInviteInput} from "@/shared/utils/linkInvites"
import DoubleRatchetInfo from "../group/components/DoubleRatchetInfo"
import {DoubleRatchetUserSearch} from "../components/DoubleRatchetUserSearch"
import {DoubleRatchetUser} from "../utils/doubleRatchetUsers"

const PrivateChatCreation = () => {
  const navigate = useNavigate()
  const myPubKey = useUserStore((state) => state.publicKey)
  const [inviteError, setInviteError] = useState<string>("")

  const handleStartChat = async (user: DoubleRatchetUser) => {
    if (!myPubKey) return
    setInviteError("")

    // Navigate directly to chat with userPubKey
    // The chats store will handle session creation automatically
    navigate("/chats/chat", {
      state: {id: user.pubkey},
    })
  }

  const extractNpub = (input: string): string | null => {
    const match = input.match(/npub1[a-zA-Z0-9]{20,65}/)
    if (!match) return null
    try {
      const decoded = nip19.decode(match[0])
      if (decoded.type === "npub") return decoded.data as string
    } catch {
      // invalid npub
    }
    return null
  }

  const handleRawInputSubmit = async (rawInput: string): Promise<boolean> => {
    if (!myPubKey) return false
    setInviteError("")

    const invite = parseChatInviteInput(rawInput)
    if (invite) {
      try {
        const ownerPubkey = await acceptChatInvite(invite)
        navigate("/chats/chat", {
          state: {id: ownerPubkey},
        })
        return true
      } catch (error) {
        setInviteError(
          error instanceof Error ? error.message : "Failed to accept chat invite"
        )
        return true
      }
    }

    const pubkey = extractNpub(rawInput)
    if (pubkey) {
      navigate("/chats/chat", {
        state: {id: pubkey},
      })
      return true
    }

    return false
  }

  if (!myPubKey) {
    return (
      <div className="m-4 p-4 md:p-8 rounded-lg bg-base-100">
        <p className="text-center text-base-content/70">
          Please sign in to use private chats
        </p>
      </div>
    )
  }

  return (
    <>
      <div className="m-4 p-4 md:p-8 rounded-lg bg-base-100 flex flex-col gap-6">
        <div>
          <h2 className="text-xl font-semibold mb-4">Search Users</h2>
          <DoubleRatchetUserSearch
            placeholder="Search users, paste npub or chat invite link"
            onUserSelect={handleStartChat}
            onRawInputSubmit={handleRawInputSubmit}
            maxResults={10}
            showCount={true}
          />
          {inviteError && <p className="text-sm text-error mt-2">{inviteError}</p>}
        </div>
      </div>
      <hr className="mx-4 my-6 border-base-300" />
      <div className="px-2">
        <DoubleRatchetInfo />
      </div>
    </>
  )
}

export default PrivateChatCreation
