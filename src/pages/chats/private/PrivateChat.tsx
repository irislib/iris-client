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
import {getSessionManagerAsync} from "@/shared/services/PrivateChats"
import {getMillisecondTimestamp} from "nostr-double-ratchet/src"
import {getEventHash} from "nostr-tools"
import {useIsTopOfStack} from "@/navigation/useIsTopOfStack"

const Chat = ({id}: {id: string}) => {
  // id is now userPubKey instead of sessionId
  const [haveReply, setHaveReply] = useState(false)
  const [haveSent, setHaveSent] = useState(false)
  const [replyingTo, setReplyingTo] = useState<MessageType | undefined>(undefined)
  const isTopOfStack = useIsTopOfStack()

  // Allow messaging regardless of session state - sessions will be created automatically

  // Get messages reactively from events store - this will update when new messages are added
  const eventsMap = usePrivateMessagesStore((state) => state.events)
  const markOpened = usePrivateMessagesStore((state) => state.markOpened)
  const messages = eventsMap.get(id) ?? new SortedMap<string, MessageType>([], comparator)
  const lastMessageEntry = messages.last()
  const lastMessage = lastMessageEntry ? lastMessageEntry[1] : undefined
  const lastMessageTimestamp = lastMessage
    ? getMillisecondTimestamp(lastMessage)
    : undefined

  const markChatOpened = useCallback(() => {
    if (!id || !isTopOfStack) return
    markOpened(id)
  }, [id, markOpened, isTopOfStack])

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
      if (document.visibilityState === "visible" && isTopOfStack) {
        markChatOpened()
      }
    }

    const handleFocus = () => {
      if (isTopOfStack) {
        markChatOpened()
      }
    }

    document.addEventListener("visibilitychange", handleVisibilityChange)
    window.addEventListener("focus", handleFocus)

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange)
      window.removeEventListener("focus", handleFocus)
    }
  }, [id, markChatOpened, isTopOfStack])

  useEffect(() => {
    if (!id || lastMessageTimestamp === undefined || !isTopOfStack) return
    markOpened(id)
  }, [id, lastMessageTimestamp, markOpened, isTopOfStack])

  const handleSendReaction = async (messageId: string, emoji: string) => {
    const myPubKey = useUserStore.getState().publicKey
    if (!myPubKey || !emoji.trim()) return

    try {
      const sessionManager = await getSessionManagerAsync()
      const now = Date.now()
      const reactionEvent = {
        content: emoji,
        kind: KIND_REACTION,
        created_at: Math.floor(now / 1000),
        tags: [
          ["p", id],
          ["e", messageId],
          ["ms", String(now)],
        ],
        pubkey: myPubKey,
        id: "",
      }

      reactionEvent.id = getEventHash(reactionEvent)

      // Add optimistically
      await usePrivateMessagesStore.getState().upsert(id, myPubKey, reactionEvent)

      // Send in background
      await sessionManager.sendEvent(id, reactionEvent)
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
