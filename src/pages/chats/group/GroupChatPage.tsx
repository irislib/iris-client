import {useState, useEffect, useCallback} from "react"
import {useLocation} from "@/navigation"
import {useGroupsStore} from "@/stores/groups"
import {usePrivateMessagesStore} from "@/stores/privateMessages"
import ChatContainer from "../components/ChatContainer"
import MessageForm from "../message/MessageForm"
import GroupChatHeader from "./GroupChatHeader"
import {SortedMap} from "@/utils/SortedMap/SortedMap"
import {MessageType} from "../message/Message"
import {comparator} from "../utils/messageGrouping"
import {getMillisecondTimestamp} from "nostr-double-ratchet"
import {useIsTopOfStack} from "@/navigation/useIsTopOfStack"

const GroupChatPage = () => {
  const location = useLocation()
  const isTopOfStack = useIsTopOfStack()
  // Extract group ID from pathname: /chats/group/:id
  const pathSegments = location.pathname.split("/").filter(Boolean)
  const id = pathSegments[2] || ""

  const groups = useGroupsStore((state) => state.groups)
  const group = id ? groups[id] : undefined
  const {events} = usePrivateMessagesStore()
  const markOpened = usePrivateMessagesStore((state) => state.markOpened)
  const [replyingTo, setReplyingTo] = useState<MessageType | undefined>(undefined)

  const messages = events.get(id) ?? new SortedMap<string, MessageType>([], comparator)
  const lastMessageEntry = messages.last()
  const lastMessage = lastMessageEntry ? lastMessageEntry[1] : undefined
  const lastMessageTimestamp = lastMessage
    ? getMillisecondTimestamp(lastMessage)
    : undefined

  const markGroupOpened = useCallback(() => {
    if (!id || !isTopOfStack) return
    markOpened(id)
  }, [id, markOpened, isTopOfStack])

  useEffect(() => {
    if (!id) return

    markGroupOpened()

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible" && isTopOfStack) {
        markGroupOpened()
      }
    }

    const handleFocus = () => {
      if (isTopOfStack) {
        markGroupOpened()
      }
    }

    document.addEventListener("visibilitychange", handleVisibilityChange)
    window.addEventListener("focus", handleFocus)

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange)
      window.removeEventListener("focus", handleFocus)
    }
  }, [id, markGroupOpened, isTopOfStack])

  useEffect(() => {
    if (!id || lastMessageTimestamp === undefined || !isTopOfStack) return
    markOpened(id)
  }, [id, lastMessageTimestamp, markOpened, isTopOfStack])

  if (!id || !group) {
    return <div className="p-4">Group not found</div>
  }

  return (
    <>
      <GroupChatHeader groupId={id} />
      <ChatContainer
        messages={messages}
        sessionId={id}
        onReply={setReplyingTo}
        showAuthor={true}
        isPublicChat={false}
        groupId={id}
        groupMembers={group.members}
      />
      <MessageForm
        id={id}
        groupId={group.id}
        groupMembers={group.members}
        replyingTo={replyingTo}
        setReplyingTo={setReplyingTo}
      />
    </>
  )
}

export default GroupChatPage
