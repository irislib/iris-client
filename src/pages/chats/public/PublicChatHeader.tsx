import MinidenticonImg from "@/shared/components/user/MinidenticonImg"
import Dropdown from "@/shared/components/ui/Dropdown"
import Header from "@/shared/components/header/Header"
import ProxyImg from "@/shared/components/ProxyImg"
import {usePublicChatsStore} from "@/stores/publicChats"
import {RiEarthLine, RiMoreLine} from "@remixicon/react"
import {useEffect, useState} from "react"
import {Link, useNavigate} from "react-router"

interface PublicChatHeaderProps {
  channelId: string
}

const PublicChatHeader = ({channelId}: PublicChatHeaderProps) => {
  const [showPlaceholder, setShowPlaceholder] = useState(false)
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const navigate = useNavigate()
  const {publicChats, removePublicChat} = usePublicChatsStore()
  const chat = publicChats[channelId]


  useEffect(() => {
    // Set a timeout to show the placeholder after 2 seconds if metadata hasn't loaded
    const timer = setTimeout(() => {
      if (!chat) {
        setShowPlaceholder(true)
      }
    }, 2000)

    return () => clearTimeout(timer)
  }, [chat])

  const handleDeleteChat = () => {
    if (channelId && confirm("Delete this chat?")) {
      removePublicChat(channelId)
      navigate("/chats")
    }
  }

  const renderTitle = () => {
    if (chat?.name) return chat.name
    if (showPlaceholder) return `Channel ${channelId.slice(0, 8)}...`
    return "\u00A0"
  }

  const renderIcon = () => {
    if (chat?.picture) {
      return (
        <ProxyImg
          width={16}
          square={true}
          src={chat.picture}
          alt="Group Icon"
          className="rounded-full"
        />
      )
    }
    return <MinidenticonImg username={channelId} width={16} />
  }

  return (
    <Header title={renderTitle()} showBack showNotifications={false} scrollDown={true} slideUp={false} bold={false}>
      <div className="flex items-center justify-between w-full">
        <Link to={`/chats/${channelId}/details`} className="flex items-center gap-2 flex-1">
          <div className="w-8 h-8 flex items-center justify-center">{renderIcon()}</div>
          <div className="flex flex-col items-start">
            <span className="font-medium flex items-center gap-1">{renderTitle()}</span>
            <span className="text-xs text-base-content/50 flex items-center gap-1">
              <RiEarthLine className="w-4 h-4" /> Public chat
            </span>
          </div>
        </Link>
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

export default PublicChatHeader
