import {initializeChat} from "@/services/sessionManager"
import ChatContainer from "../components/ChatContainer"
import {SortedMap} from "@/utils/SortedMap/SortedMap"
import {comparator} from "../utils/messageGrouping"
import PrivateChatHeader from "./PrivateChatHeader"
import {useState, useMemo, useEffect} from "react"
import MessageForm from "../message/MessageForm"
import {MessageType} from "../message/Message"
import {useEventsStore} from "@/stores/events"

const Chat = ({id}: {id: string}) => {
  const [replyingTo, setReplyingTo] = useState<MessageType | undefined>(undefined)
  const events = useEventsStore((state) => state.events)

  useEffect(() => {
    // Initialize chat session
    initializeChat(id)
  }, [id])

  // Get messages for this chat from events store
  const messagesMemo = useMemo(() => {
    const chatMessages = events.get(id)
    return chatMessages || new SortedMap<string, MessageType>([], comparator)
  }, [events, id])


  if (!id) {
    return null
  }

  return (
    <>
      <PrivateChatHeader id={id} messages={messagesMemo} />
      <ChatContainer
        messages={messagesMemo}
        sessionId={id}
        onReply={setReplyingTo}
      />
      <MessageForm
        id={id}
        replyingTo={replyingTo}
        setReplyingTo={setReplyingTo}
      />
    </>
  )
}

export default Chat
