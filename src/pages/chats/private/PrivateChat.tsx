import SessionManager from "nostr-double-ratchet/src/SessionManager"
import {useSessionManager} from "@/stores/sessionManager"
import ChatContainer from "../components/ChatContainer"
import {SortedMap} from "@/utils/SortedMap/SortedMap"
import {comparator} from "../utils/messageGrouping"
import PrivateChatHeader from "./PrivateChatHeader"
import {useState, useMemo, useEffect} from "react"
import MessageForm from "../message/MessageForm"
import {MessageType} from "../message/Message"

const Chat = ({id}: {id: string}) => {
  const [replyingTo, setReplyingTo] = useState<MessageType | undefined>(undefined)
  const [manager, setManager] = useState<SessionManager | undefined>(undefined)
  const [messages, setMessages] = useState<MessageType[]>([])
  const {ready, getManager} = useSessionManager()

  // id is the recipient's pubkey
  const recipientPubKey = id

  useEffect(() => {
    getManager().then(setManager)
  }, [getManager, id])

  useEffect(() => {
    if (!manager) return

    // Listen for new events and update messages directly
    const unsubscribe = manager.onEvent((event: unknown) => {
      // If the event is a message for this chat, add it to state
      // You may want to check event type/kind here
      console.log("manager.onEvent", event)
      const msg = event as MessageType
      if (msg && msg.sender === recipientPubKey) {
        setMessages((prev) => [...prev, msg])
      }
    })

    return unsubscribe
  }, [manager, recipientPubKey])

  // Re-compute messages whenever eventTick changes
  const messagesMemo = useMemo(() => {
    return new SortedMap<string, MessageType>(
      messages.map((m) => [m.id, m]),
      comparator
    )
  }, [messages])

  console.log("recipientPubKey", recipientPubKey)
  console.log("manager", manager)
  console.log("ready", ready)

  if (!recipientPubKey || !manager || !ready) {
    return null
  }

  return (
    <>
      <PrivateChatHeader id={recipientPubKey} messages={messagesMemo} />
      <ChatContainer
        messages={messagesMemo}
        sessionId={recipientPubKey}
        onReply={setReplyingTo}
      />
      <MessageForm
        id={recipientPubKey}
        replyingTo={replyingTo}
        setReplyingTo={setReplyingTo}
      />
    </>
  )
}

export default Chat
