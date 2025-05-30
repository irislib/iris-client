import {ConnectionStatus} from "@/shared/components/connection/ConnectionStatus"
import {getPeerConnection} from "@/utils/chat/webrtc/PeerConnection"
import {RiMoreLine, RiAttachment2} from "@remixicon/react"
import {UserRow} from "@/shared/components/user/UserRow"
import Header from "@/shared/components/header/Header"
import Dropdown from "@/shared/components/ui/Dropdown"
import {SortedMap} from "@/utils/SortedMap/SortedMap"
import {useSessionsStore} from "@/stores/sessions"
import {MessageType} from "../message/Message"
import socialGraph from "@/utils/socialGraph"
import {usePublicKey} from "@/stores/user"
import {useNavigate} from "react-router"
import {useState} from "react"
interface PrivateChatHeaderProps {
  id: string
  messages: SortedMap<string, MessageType>
}

const PrivateChatHeader = ({id}: PrivateChatHeaderProps) => {
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const myPubKey = usePublicKey()
  const navigate = useNavigate()
  const {sessions, deleteSession} = useSessionsStore()
  const session = sessions.get(id)

  const handleDeleteChat = () => {
    if (id && confirm("Delete this chat?")) {
      deleteSession(id)
      navigate("/chats")
    }
  }

  const handleSendFile = () => {
    if (session) {
      const peerConnection = getPeerConnection(id, {
        ask: false,
        create: true,
        connect: true,
      })
      if (peerConnection) {
        // Create a hidden file input
        const fileInput = document.createElement("input")
        fileInput.type = "file"
        fileInput.style.display = "none"
        fileInput.onchange = (e) => {
          const file = (e.target as HTMLInputElement).files?.[0]
          if (file) {
            peerConnection.sendFile(file)
          }
        }
        document.body.appendChild(fileInput)
        fileInput.click()
        document.body.removeChild(fileInput)
      }
    }
  }

  const user = id.split(":").shift()!

  const showWebRtc =
    socialGraph().getFollowedByUser(user).has(myPubKey) || user === myPubKey

  return (
    <Header showNotifications={false} scrollDown={true} slideUp={false} bold={false}>
      <div className="flex items-center justify-between w-full">
        <div className="flex flex-row items-center gap-2">
          {id && <UserRow avatarWidth={32} pubKey={user} />}
          <ConnectionStatus peerId={id} showDisconnect={true} />
        </div>
        <div className="flex items-center gap-2 relative">
          {showWebRtc && (
            <button
              onClick={handleSendFile}
              className="btn btn-ghost btn-sm btn-circle"
              title="Send file"
            >
              <RiAttachment2 className="h-5 w-5 cursor-pointer text-base-content/50" />
            </button>
          )}
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
