import ChatContainer from "../components/ChatContainer"
import {SortedMap} from "@/utils/SortedMap/SortedMap"
import {comparator} from "../utils/messageGrouping"
import PrivateChatHeader from "./PrivateChatHeader"
import {usePrivateChatsStore} from "@/stores/privateChats"
import {useEventsStore} from "@/stores/events"
import MessageForm from "../message/MessageForm"
import {MessageType} from "../message/Message"
import {useEffect, useState} from "react"
import {useUserRecordsStore} from "@/stores/userRecords"

const Chat = ({id}: {id: string}) => {
  // id is now userPubKey instead of sessionId
  const {updateLastSeen} = usePrivateChatsStore()
  const [haveReply, setHaveReply] = useState(false)
  const [haveSent, setHaveSent] = useState(false)
  const [replyingTo, setReplyingTo] = useState<MessageType | undefined>(undefined)

  // Get all sessions for this user
  const sessions = useUserRecordsStore((state) => state.sessions)
  const userSessions = Array.from(sessions.keys()).filter((sessionId) =>
    sessionId.startsWith(`${id}:`)
  )
  const hasAnySessions = userSessions.length > 0

  // Get messages reactively from events store - this will update when new messages are added
  const eventsMap = useEventsStore((state) => state.events)
  const messages = eventsMap.get(id) ?? new SortedMap<string, MessageType>([], comparator)

  useEffect(() => {
    if (!id || !hasAnySessions) {
      return
    }

    if (!messages) return

    Array.from(messages.entries()).forEach(([, message]) => {
      if (!haveReply && message.pubkey !== "user") {
        setHaveReply(true)
      }
      if (!haveSent && message.pubkey === "user") {
        setHaveSent(true)
      }
    })
  }, [id, messages, haveReply, haveSent, hasAnySessions])

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

  if (!id) {
    return null
  }

  return (
    <>
      <PrivateChatHeader id={id} messages={messages} />
      <ChatContainer messages={messages} sessionId={id} onReply={setReplyingTo} />
      <MessageForm id={id} replyingTo={replyingTo} setReplyingTo={setReplyingTo} />
    </>
  )
}

export default Chat
