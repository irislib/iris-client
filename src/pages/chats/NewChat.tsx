import NotificationPrompt from "@/shared/components/NotificationPrompt"
import InstallPWAPrompt from "@/shared/components/InstallPWAPrompt"
import PrivateChatCreation from "./private/PrivateChatCreation"
import {Link, Routes, Route, useLocation} from "react-router"
import PublicChatCreation from "./public/PublicChatCreation"
import Header from "@/shared/components/header/Header"

const TabSelector = () => {
  const location = useLocation()
  const isPublic = location.pathname === "/chats/new/public"

  const getClasses = (isActive: boolean) => {
    const baseClasses = "border-highlight cursor-pointer flex justify-center flex-1 p-3"
    return isActive
      ? `${baseClasses} border-b border-1`
      : `${baseClasses} text-base-content/70 hover:text-base-content border-b border-1 border-transparent`
  }

  return (
    <div className="flex mb-px md:mb-1">
      <Link to="/chats/new" className={getClasses(!isPublic)}>
        Private
      </Link>
      <Link to="/chats/new/public" className={getClasses(isPublic)}>
        Public
      </Link>
    </div>
  )
}

const NewChat = () => {
  return (
    <>
      <Header title="New Chat" />
      <NotificationPrompt />
      <TabSelector />
      <Routes>
        <Route path="/" element={<PrivateChatCreation />} />
        <Route path="/public" element={<PublicChatCreation />} />
      </Routes>
      <InstallPWAPrompt />
    </>
  )
}

export default NewChat
