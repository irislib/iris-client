import NotificationPrompt from "@/shared/components/NotificationPrompt"
import {RiUserLine, RiTeamLine, RiEarthLine} from "@remixicon/react"
import InstallPWAPrompt from "@/shared/components/InstallPWAPrompt"
import PrivateChatCreation from "./private/PrivateChatCreation"
import {Link, Routes, Route, useLocation} from "react-router"
import PublicChatCreation from "./public/PublicChatCreation"
import GroupChatCreation from "./group/GroupChatCreation"
import Header from "@/shared/components/header/Header"
import PublicChannelCreateStep from "./public/PublicChannelCreateStep"
import Icon from "@/shared/components/Icons/Icon"

const TabSelector = () => {
  const location = useLocation()
  const isPublic = location.pathname.startsWith("/chats/new/public")
  const isGroup = location.pathname.startsWith("/chats/new/group")

  const getClasses = (isActive: boolean) => {
    const baseClasses =
      "border-highlight cursor-pointer flex items-center justify-center flex-1 p-3"
    return isActive
      ? `${baseClasses} border-b border-1`
      : `${baseClasses} text-base-content/70 hover:text-base-content border-b border-1 border-transparent`
  }

  return (
    <div className="flex mb-px md:mb-1">
      <Link to="/chats/new" className={getClasses(!isPublic && !isGroup)}>
        <RiUserLine className="mr-2 w-4 h-4" />
        Direct
      </Link>
      <Link to="/chats/new/group" className={getClasses(isGroup)}>
        <RiTeamLine className="mr-2 w-4 h-4" />
        Group
      </Link>
      <Link to="/chats/new/public" className={getClasses(isPublic)}>
        <RiEarthLine className="mr-2 w-4 h-4" />
        Public
      </Link>
    </div>
  )
}

const NewChat = () => {
  return (
    <>
      <Header title="New Chat">
        <Link
          to="/settings/chat"
          className="btn btn-circle btn-ghost btn-sm ml-auto"
          title="Chat Settings"
        >
          <Icon name="gear" className="w-5 h-5" />
        </Link>
      </Header>
      <NotificationPrompt />
      <TabSelector />
      <Routes>
        <Route path="/" element={<PrivateChatCreation />} />
        <Route path="/public" element={<PublicChatCreation />} />
        <Route path="/public/create" element={<PublicChannelCreateStep />} />
        <Route path="/group" element={<GroupChatCreation />} />
      </Routes>
      <InstallPWAPrompt />
    </>
  )
}

export default NewChat
