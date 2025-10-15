import {useState} from "react"
import {useLocation} from "@/navigation"
import {useGroupsStore} from "@/stores/groups"
import {usePrivateMessagesStore} from "@/stores/privateMessages"
import ChatContainer from "../components/ChatContainer"
import MessageForm from "../message/MessageForm"
import GroupChatHeader from "./GroupChatHeader"
import {SortedMap} from "@/utils/SortedMap/SortedMap"
import {MessageType} from "../message/Message"
import {comparator} from "../utils/messageGrouping"

const GroupChatPage = () => {
  const location = useLocation()
  // Extract group ID from pathname: /chats/group/:id
  const pathSegments = location.pathname.split("/").filter(Boolean)
  const id = pathSegments[2] || ""

  const groups = useGroupsStore((state) => state.groups)
  const group = id ? groups[id] : undefined
  const {events} = usePrivateMessagesStore()
  const [replyingTo, setReplyingTo] = useState<MessageType | undefined>(undefined)

  if (!id || !group) {
    return <div className="p-4">Group not found</div>
  }

  const messages = events.get(id) ?? new SortedMap<string, MessageType>([], comparator)

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
