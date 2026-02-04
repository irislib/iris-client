import {RiMoreLine} from "@remixicon/react"
import {UserRow} from "@/shared/components/user/UserRow"
import Header from "@/shared/components/header/Header"
import Dropdown from "@/shared/components/ui/Dropdown"
import {SortedMap} from "@/utils/SortedMap/SortedMap"
import {MessageType} from "../message/Message"
import {useNavigate} from "@/navigation"
import {useState} from "react"
import {getSessionManager} from "@/shared/services/PrivateChats"
import {usePrivateMessagesStore} from "@/stores/privateMessages"
import {confirm} from "@/utils/utils"
interface PrivateChatHeaderProps {
  id: string
  messages: SortedMap<string, MessageType>
}

const PrivateChatHeader = ({id}: PrivateChatHeaderProps) => {
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const navigate = useNavigate()
  const handleDeleteChat = async () => {
    if (!id) return

    if (!(await confirm("Delete this chat?"))) return

    try {
      const sessionManager = getSessionManager()
      if (!sessionManager) {
        console.error("Session manager not available")
        return
      }
      await sessionManager.deleteUser(id)
      await usePrivateMessagesStore.getState().removeSession(id)
      navigate("/chats")
    } catch (error) {
      console.error("Failed to delete chat", error)
    }
  }

  const user = id.split(":").shift()!

  return (
    <Header showNotifications={false} scrollDown={true} slideUp={false} bold={false}>
      <div className="flex items-center justify-between w-full">
        <div className="flex flex-row items-center gap-2">
          {id && <UserRow avatarWidth={32} pubKey={user} />}
        </div>
        <div className="flex items-center gap-2 relative">
          <button
            onClick={() => setDropdownOpen(!dropdownOpen)}
            className="btn btn-ghost btn-sm btn-circle"
          >
            <RiMoreLine className="h-6 w-6 cursor-pointer text-base-content/50" />
          </button>
          {dropdownOpen && (
            <Dropdown onClose={() => setDropdownOpen(false)}>
              <ul className="dropdown-content z-[1] menu p-2 shadow bg-base-100 rounded-box w-52">
                <li>
                  <button onClick={handleDeleteChat}>Delete Chat</button>
                </li>
              </ul>
            </Dropdown>
          )}
        </div>
      </div>
    </Header>
  )
}

export default PrivateChatHeader
