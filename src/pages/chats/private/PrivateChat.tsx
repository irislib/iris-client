import ChatContainer from "../components/ChatContainer"
import {SortedMap} from "@/utils/SortedMap/SortedMap"
import {comparator} from "../utils/messageGrouping"
import PrivateChatHeader from "./PrivateChatHeader"
import {usePrivateMessagesStore} from "@/stores/privateMessages"
import MessageForm from "../message/MessageForm"
import {MessageType} from "../message/Message"
import {useEffect, useState, useCallback} from "react"
import {useUserStore} from "@/stores/user"
import {KIND_REACTION} from "@/utils/constants"
import {getSessionManager} from "@/shared/services/PrivateChats"
import {getMillisecondTimestamp} from "nostr-double-ratchet/src"

const Chat = ({id}: {id: string}) => {
  // id is now userPubKey instead of sessionId
  const [haveReply, setHaveReply] = useState(false)
  const [haveSent, setHaveSent] = useState(false)
  const [replyingTo, setReplyingTo] = useState<MessageType | undefined>(undefined)

  // Allow messaging regardless of session state - sessions will be created automatically

  // Get messages reactively from events store - this will update when new messages are added
  const eventsMap = usePrivateMessagesStore((state) => state.events)
  const updateLastSeen = usePrivateMessagesStore((state) => state.updateLastSeen)
  const messages = eventsMap.get(id) ?? new SortedMap<string, MessageType>([], comparator)
  const lastMessageEntry = messages.last()
  const lastMessage = lastMessageEntry ? lastMessageEntry[1] : undefined
  const lastMessageTimestamp = lastMessage
    ? getMillisecondTimestamp(lastMessage)
    : undefined
  const lastMessageId = lastMessage?.id

  const markChatOpened = useCallback(() => {
    if (!id) return
    const events = usePrivateMessagesStore.getState().events
    const latestMessage = events.get(id)?.last()?.[1]
    const latestTimestamp = latestMessage
      ? getMillisecondTimestamp(latestMessage)
      : undefined
    const targetTimestamp = Math.max(Date.now(), latestTimestamp ?? 0)
    const current = usePrivateMessagesStore.getState().lastSeen.get(id) || 0
    if (targetTimestamp > current) {
      updateLastSeen(id, targetTimestamp)
    }
  }, [id, updateLastSeen])

  useEffect(() => {
    if (!id) {
      return
    }

    if (!messages) return

    const myPubKey = useUserStore.getState().publicKey
    Array.from(messages.entries()).forEach(([, message]) => {
      if (!haveReply && message.pubkey !== myPubKey) {
        setHaveReply(true)
      }
      if (!haveSent && message.pubkey === myPubKey) {
        setHaveSent(true)
      }
    })
  }, [id, messages, haveReply, haveSent])

  useEffect(() => {
    if (!id) return

    markChatOpened()

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        markChatOpened()
      }
    }

    const handleFocus = () => {
      markChatOpened()
    }

    document.addEventListener("visibilitychange", handleVisibilityChange)
    window.addEventListener("focus", handleFocus)

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange)
      window.removeEventListener("focus", handleFocus)
    }
  }, [id, markChatOpened])

  useEffect(() => {
    if (!id || lastMessageTimestamp === undefined) return
    const existing = usePrivateMessagesStore.getState().lastSeen.get(id) || 0
    if (lastMessageTimestamp > existing) {
      updateLastSeen(id, lastMessageTimestamp)
    }
  }, [id, lastMessageId, lastMessageTimestamp, updateLastSeen])

  const handleSendReaction = async (messageId: string, emoji: string) => {
    const myPubKey = useUserStore.getState().publicKey
    if (!myPubKey || !emoji.trim()) return

    try {
      const sessionManager = getSessionManager()
      const timestampSeconds = Math.floor(Date.now() / 1000)
      const reactionEvent = {
        id: crypto.randomUUID(),
        pubkey: myPubKey,
        kind: KIND_REACTION,
        content: emoji,
        created_at: timestampSeconds,
        tags: [
          ["p", id],
          ["e", messageId],
          ["ms", String(Date.now())],
        ],
      }

      await sessionManager.sendEvent(id, reactionEvent)
      await usePrivateMessagesStore
        .getState()
        .upsert(useUserStore.getState().publicKey, id, reactionEvent)
    } catch (error) {
      console.error("Failed to send reaction:", error)
    }
  }

  if (!id) {
    return null
  }

  return (
    <>
      <PrivateChatHeader id={id} messages={messages} />
      <ChatContainer
        messages={messages}
        sessionId={id}
        onReply={setReplyingTo}
        onSendReaction={handleSendReaction}
      />
      <MessageForm id={id} replyingTo={replyingTo} setReplyingTo={setReplyingTo} />
    </>
  )
}

export default Chat
