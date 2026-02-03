import NotificationPrompt from "@/shared/components/NotificationPrompt"
import {RiUserLine, RiTeamLine, RiEarthLine, RiComputerLine} from "@remixicon/react"
import InstallPWAPrompt from "@/shared/components/InstallPWAPrompt"
import PrivateChatCreation from "./private/PrivateChatCreation"
import {Link, useLocation} from "@/navigation"
import PublicChatCreation from "./public/PublicChatCreation"
import GroupChatCreation from "./group/GroupChatCreation"
import DevicesTab from "./devices"
import Header from "@/shared/components/header/Header"
import PublicChannelCreateStep from "./public/PublicChannelCreateStep"

const TabSelector = () => {
  const location = useLocation()
  const isPublic = location.pathname.startsWith("/chats/new/public")
  const isGroup = location.pathname.startsWith("/chats/new/group")
  const isDevices = location.pathname.startsWith("/chats/new/devices")

  const getClasses = (isActive: boolean) => {
    const baseClasses =
      "border-highlight cursor-pointer flex items-center justify-center flex-1 p-3"
    return isActive
      ? `${baseClasses} border-b border-1`
      : `${baseClasses} text-base-content/70 hover:text-base-content border-b border-1 border-transparent`
  }

  return (
    <div className="flex mb-px md:mb-1">
      <Link to="/chats/new" className={getClasses(!isPublic && !isGroup && !isDevices)}>
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
      <Link to="/chats/new/devices" className={getClasses(isDevices)}>
        <RiComputerLine className="mr-2 w-4 h-4" />
        Devices
      </Link>
    </div>
  )
}

const NewChat = () => {
  const location = useLocation()

  // Determine which component to show based on the path
  let content = null
  if (location.pathname === "/chats/new/public/create") {
    content = <PublicChannelCreateStep />
  } else if (location.pathname === "/chats/new/public") {
    content = <PublicChatCreation />
  } else if (location.pathname === "/chats/new/group") {
    content = <GroupChatCreation />
  } else if (location.pathname === "/chats/new/devices") {
    content = <DevicesTab />
  } else {
    // Default to private chat creation for /chats/new
    content = <PrivateChatCreation />
  }

  return (
    <>
      <Header title="New Chat" />
      <div className="pt-[calc(4rem+env(safe-area-inset-top))] pb-[calc(4rem+env(safe-area-inset-bottom))] md:pt-0 md:pb-0">
        <NotificationPrompt />
        <TabSelector />
        {content}
        <InstallPWAPrompt />
      </div>
    </>
  )
}

export default NewChat
