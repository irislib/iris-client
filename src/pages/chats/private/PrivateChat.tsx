import ChatContainer from "../components/ChatContainer"
import {SortedMap} from "@/utils/SortedMap/SortedMap"
import {comparator} from "../utils/messageGrouping"
import PrivateChatHeader from "./PrivateChatHeader"
import {useSessionsStore} from "@/stores/sessions"
import MessageForm from "../message/MessageForm"
import {MessageType} from "../message/Message"
import {useEventsStore} from "@/stores/events"
import {useEffect, useState} from "react"

const Chat = ({id}: {id: string}) => {
  const {sessions, updateLastSeen} = useSessionsStore()
  const {events} = useEventsStore()
  const [haveReply, setHaveReply] = useState(false)
  const [haveSent, setHaveSent] = useState(false)
  const [replyingTo, setReplyingTo] = useState<MessageType | undefined>(undefined)
  const session = sessions.get(id)!

  useEffect(() => {
    if (!(id && session)) {
      return
    }

    const sessionEvents = events.get(id)
    if (!sessionEvents) return

    Array.from(sessionEvents.entries()).forEach(([_messageId, message]) => {
      if (!haveReply && message.sender !== "user") {
        setHaveReply(true)
      }
      if (!haveSent && message.sender === "user") {
        setHaveSent(true)
      }
    })
  }, [id, session, events])

  useEffect(() => {
    if (!id) return

    updateLastSeen(id)

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        updateLastSeen(id)
      }
    }

    const handleFocus = () => {
      updateLastSeen(id)
    }

    document.addEventListener("visibilitychange", handleVisibilityChange)
    window.addEventListener("focus", handleFocus)

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange)
      window.removeEventListener("focus", handleFocus)
    }
  }, [id, updateLastSeen])

  if (!id || !session) {
    return null
  }

  const messages = events.get(id) ?? new SortedMap<string, MessageType>([], comparator)

  return (
    <>
      <PrivateChatHeader id={id} messages={messages} />
      <ChatContainer
        messages={messages}
        session={session}
        sessionId={id}
        onReply={setReplyingTo}
      />
      <MessageForm id={id} replyingTo={replyingTo} setReplyingTo={setReplyingTo} />
    </>
  )
}

export default Chat
