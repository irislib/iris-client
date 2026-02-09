import ChatContainer from "../components/ChatContainer"
import {SortedMap} from "@/utils/SortedMap/SortedMap"
import {comparator} from "../utils/messageGrouping"
import PrivateChatHeader from "./PrivateChatHeader"
import {usePrivateMessagesStore} from "@/stores/privateMessages"
import {useMessagesStore} from "@/stores/messages"
import MessageForm from "../message/MessageForm"
import {MessageType} from "../message/Message"
import {useEffect, useState, useCallback} from "react"
import {useUserStore} from "@/stores/user"
import {KIND_REACTION} from "@/utils/constants"
import {getSessionManager} from "@/shared/services/PrivateChats"
import {getMillisecondTimestamp} from "nostr-double-ratchet"
import {getEventHash} from "nostr-tools"
import {useIsTopOfStack} from "@/navigation/useIsTopOfStack"
import {markMessagesSeenAndMaybeSendReceipt} from "../utils/seenReceipts"
import {markMessagesDeliveredAndMaybeSendReceipt} from "../utils/deliveredReceipts"
import {useIsFollowing} from "@/utils/socialGraph"
import {getMessageAuthorPubkey} from "@/pages/chats/utils/messageAuthor"
import {useMessageRequestsStore} from "@/stores/messageRequests"
import {useNavigate} from "@/navigation"
import {useUIStore} from "@/stores/ui"

const Chat = ({id}: {id: string}) => {
  // id is now userPubKey instead of sessionId
  const [haveReply, setHaveReply] = useState(false)
  const [haveSent, setHaveSent] = useState(false)
  const [replyingTo, setReplyingTo] = useState<MessageType | undefined>(undefined)
  const isTopOfStack = useIsTopOfStack()
  const navigate = useNavigate()
  const sendReadReceipts = useMessagesStore((state) => state.sendReadReceipts)
  const sendDeliveryReceipts = useMessagesStore((state) => state.sendDeliveryReceipts)
  const myPubKey = useUserStore((state) => state.publicKey)
  const isFollowing = useIsFollowing(myPubKey, id)
  const isLocallyAccepted = useMessageRequestsStore((state) => !!state.acceptedChats[id])
  const acceptChat = useMessageRequestsStore((state) => state.acceptChat)
  const rejectChat = useMessageRequestsStore((state) => state.rejectChat)
  const isChatAccepted = isFollowing || haveSent || isLocallyAccepted

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

  const handleAcceptRequest = useCallback(() => {
    if (!id) return

    acceptChat(id)
    useUIStore.getState().setChatsListActiveTab("all")

    if (!myPubKey) return

    const sessionManager = getSessionManager()
    if (!sessionManager) return

    const messageMap = usePrivateMessagesStore.getState().events.get(id)
    if (!messageMap) return
    const store = usePrivateMessagesStore.getState()

    markMessagesDeliveredAndMaybeSendReceipt({
      chatId: id,
      messages: messageMap.values(),
      myPubKey,
      updateMessage: store.updateMessage,
      sessionManager,
      sendDeliveryReceipts,
      isChatAccepted: true,
    })
  }, [id, acceptChat, myPubKey, sendDeliveryReceipts])

  const handleRejectRequest = useCallback(() => {
    if (!id) return

    rejectChat(id)

    const sessionManager = getSessionManager()
    const store = usePrivateMessagesStore.getState()
    void Promise.all([
      sessionManager?.deleteUser(id).catch(() => {}),
      store.removeSession(id).catch(() => {}),
    ]).finally(() => {
      navigate("/chats")
    })
  }, [id, rejectChat, navigate])

  const sendSeenReceipts = useCallback(() => {
    if (!id || !isTopOfStack) return
    const sessionManager = getSessionManager()
    if (!sessionManager) return
    if (!myPubKey) return

    const messageMap = usePrivateMessagesStore.getState().events.get(id)
    if (!messageMap) return
    const store = usePrivateMessagesStore.getState()

    markMessagesSeenAndMaybeSendReceipt({
      chatId: id,
      messages: messageMap.values(),
      myPubKey,
      updateMessage: store.updateMessage,
      sessionManager,
      sendReadReceipts,
      isChatAccepted,
    })
  }, [id, isTopOfStack, myPubKey, sendReadReceipts, isChatAccepted])

  const markChatOpened = useCallback(() => {
    if (!id || !isTopOfStack) return
    markOpened(id)
    sendSeenReceipts()
  }, [id, markOpened, isTopOfStack, sendSeenReceipts])

  useEffect(() => {
    if (!id) {
      return
    }

    if (!messages) return

    const myPubKey = useUserStore.getState().publicKey
    Array.from(messages.entries()).forEach(([, message]) => {
      const owner = getMessageAuthorPubkey(message)
      if (!haveReply && owner !== myPubKey) {
        setHaveReply(true)
      }
      if (!haveSent && owner === myPubKey) {
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

  useEffect(() => {
    if (!id || !isTopOfStack) return
    sendSeenReceipts()
  }, [id, isTopOfStack, messages.size, sendSeenReceipts])

  const handleSendReaction = async (messageId: string, emoji: string) => {
    const myPubKey = useUserStore.getState().publicKey
    if (!myPubKey || !emoji.trim()) return

    try {
      const sessionManager = getSessionManager()
      if (!sessionManager) {
        console.error("Session manager not available")
        return
      }
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
        bottomContent={
          !isChatAccepted ? (
            <div className="flex justify-center" data-testid="message-request-actions">
              <div className="w-full max-w-lg bg-base-200 border border-custom rounded-xl p-3">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="text-sm text-base-content/70">Message request</div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className="btn btn-sm btn-primary"
                      onClick={handleAcceptRequest}
                    >
                      Accept
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm text-error hover:bg-error hover:text-error-content"
                      onClick={handleRejectRequest}
                    >
                      Reject
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ) : null
        }
      />
      <MessageForm id={id} replyingTo={replyingTo} setReplyingTo={setReplyingTo} />
    </>
  )
}

export default Chat
