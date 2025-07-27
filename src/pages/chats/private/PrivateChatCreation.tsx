import {useNavigate} from "react-router"
import {useUserStore} from "@/stores/user"
import DoubleRatchetInfo from "../group/components/DoubleRatchetInfo"
import {DoubleRatchetUserSearch} from "../components/DoubleRatchetUserSearch"
import {DoubleRatchetUser} from "../utils/doubleRatchetUsers"

const PrivateChatCreation = () => {
  const navigate = useNavigate()
  const myPubKey = useUserStore((state) => state.publicKey)

  const handleStartChat = async (user: DoubleRatchetUser) => {
    if (!myPubKey) return

    // Navigate directly to chat with userPubKey
    // The chats store will handle session creation automatically
    navigate("/chats/chat", {
      state: {id: user.pubkey},
    })
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
            placeholder="Search for users"
            onUserSelect={handleStartChat}
            maxResults={10}
            showCount={true}
          />
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
