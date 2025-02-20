import {useLocation, Routes, Route} from "react-router-dom"
import {Helmet} from "react-helmet"
import classNames from "classnames"
import ChatList from "./ChatList"
import NewChat from "./NewChat"
import Chat from "./Chat"

function Messages() {
  const location = useLocation()
  const isMessagesRoot = location.pathname === "/messages"

  return (
    <div className="flex flex-1 h-full relative">
      <ChatList
        className={classNames(
          "sticky top-0 w-full md:w-80 md:h-screen overflow-y-auto border-r border-custom",
          {
            "hidden md:block": !isMessagesRoot,
            block: isMessagesRoot,
          }
        )}
      />
      <div
        className={classNames("flex-1 flex flex-col xl:border-r border-custom", {
          "hidden md:flex": isMessagesRoot,
          flex: !isMessagesRoot,
        })}
      >
        <Routes>
          <Route path="new" element={<NewChat />} />
          <Route path="chat" element={<Chat id={location.state?.id} />} />
          <Route path="/" element={<NewChat />} />
        </Routes>
      </div>
      <Helmet>
        <title>Messages</title>
      </Helmet>
    </div>
  )
}

export default Messages
