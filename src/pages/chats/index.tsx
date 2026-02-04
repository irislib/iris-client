import PublicChatDetails from "./public/PublicChatDetails"
import {useLocation} from "@/navigation"
import PrivateChat from "./private/PrivateChat"
import PublicChat from "./public/PublicChat"
import ChatList from "./list/ChatList"
import {Helmet} from "react-helmet"
import classNames from "classnames"
import NewChat from "./NewChat"
import GroupGroupRoutes from "./group"
import {useMessagesStore} from "@/stores/messages"

function Messages() {
  const location = useLocation()
  const isMessagesRoot = location.pathname === "/chats"
  const enablePublicChats = useMessagesStore((state) => state.enablePublicChats)

  return (
    <div className="flex flex-1 h-full relative overflow-hidden">
      <ChatList
        className={classNames(
          "sticky top-0 w-full md:w-80 md:h-screen overflow-y-auto md:border-r border-custom",
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
        {(() => {
          const pathSegments = location.pathname.split("/").filter(Boolean)
          // pathSegments: ['chats'] or ['chats', 'new'] or ['chats', 'chat'] etc.

          if (pathSegments.length === 1) {
            // Just /chats - show NewChat
            return <NewChat />
          }

          const subPath = pathSegments[1]

          if (subPath === "new") {
            return <NewChat />
          } else if (subPath === "chat") {
            return (
              <PrivateChat
                key={location.state?.id as string}
                id={location.state?.id as string}
              />
            )
          } else if (subPath === "group") {
            return <GroupGroupRoutes />
          } else if (pathSegments[2] === "details") {
            // :id/details
            return enablePublicChats ? <PublicChatDetails /> : <NewChat />
          } else if (subPath) {
            // :id - public chat
            return enablePublicChats ? (
              <PublicChat key={location.pathname} />
            ) : (
              <NewChat />
            )
          }

          return <NewChat />
        })()}
      </div>
      <Helmet>
        <title>Messages</title>
      </Helmet>
    </div>
  )
}

export default Messages
