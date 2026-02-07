import {
  useLayoutEffect,
  useRef,
  useState,
  useEffect,
  useMemo,
  type ReactNode,
} from "react"
import ErrorBoundary from "@/shared/components/ui/ErrorBoundary"
import {getMillisecondTimestamp} from "nostr-double-ratchet/src"
import Message, {MessageType} from "../message/Message"
import {groupMessages} from "../utils/messageGrouping"
import {SortedMap} from "@/utils/SortedMap/SortedMap"
import {useUserStore} from "@/stores/user"
import {getSessionManager} from "@/shared/services/PrivateChats"
import {usePrivateMessagesStore} from "@/stores/privateMessages"
import {useTypingStore} from "@/stores/typingIndicators"
import {KIND_REACTION} from "@/utils/constants"
import {getEventHash} from "nostr-tools"
import ReverseVirtualScroll from "@/shared/components/ui/ReverseVirtualScroll"
import {formatDayLabel} from "@/utils/utils"

interface ChatContainerProps {
  messages: SortedMap<string, MessageType>
  sessionId: string
  onReply: (message: MessageType) => void
  bottomContent?: ReactNode
  showAuthor?: boolean
  isPublicChat?: boolean
  initialLoadDone?: boolean
  showNoMessages?: boolean
  onSendReaction?: (messageId: string, emoji: string) => Promise<void>
  groupId?: string
  groupMembers?: string[]
}

const INITIAL_RENDER_COUNT = 25
const LOAD_MORE_COUNT = 30

const ChatContainer = ({
  messages,
  sessionId,
  onReply,
  bottomContent,
  showAuthor = false,
  isPublicChat = false,
  initialLoadDone = false,
  showNoMessages = false,
  onSendReaction,
  groupId,
  groupMembers,
}: ChatContainerProps) => {
  const [showScrollDown, setShowScrollDown] = useState(false)
  const [renderCount, setRenderCount] = useState(INITIAL_RENDER_COUNT)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const chatContainerRef = useRef<HTMLDivElement>(null)
  const wasAtBottomRef = useRef(true)
  const lastMessageCountRef = useRef(messages.size)
  const lastMessageIdsRef = useRef<Set<string>>(new Set())
  const resizeObserverRef = useRef<ResizeObserver | null>(null)
  const lastHeightRef = useRef(0)
  const hasInitiallyScrolledRef = useRef(false)
  const typingActive = useTypingStore((state) =>
    !isPublicChat && !groupId ? (state.isTyping.get(sessionId) ?? false) : false
  )

  // Create windowed messages - show last N messages
  const visibleMessages = useMemo(() => {
    const totalMessages = messages.size
    if (totalMessages <= renderCount) {
      return messages
    }

    const startIndex = Math.max(0, totalMessages - renderCount)
    const windowed = new SortedMap<string, MessageType>(
      undefined,
      "created_at" // Messages sorted by created_at timestamp
    )

    let i = 0
    for (const [key, value] of messages) {
      if (i >= startIndex) {
        windowed.set(key, value)
      }
      i++
    }

    return windowed
  }, [messages, renderCount])

  const isDirectMessage = !isPublicChat && !groupId
  const messageGroups = groupMessages(visibleMessages, undefined, isPublicChat, isDirectMessage)

  const handleLoadMore = () => {
    setRenderCount((prev) => Math.min(prev + LOAD_MORE_COUNT, messages.size))
  }

  const canLoadMore = renderCount < messages.size

  // Create reaction handler for groups
  const handleReaction = async (messageId: string, emoji: string) => {
    if (onSendReaction) {
      return onSendReaction(messageId, emoji)
    }

    // Group reaction handling
    if (groupId && groupMembers) {
      const myPubKey = useUserStore.getState().publicKey
      if (!myPubKey) return

      const sessionManager = getSessionManager()
      if (!sessionManager) return

      const now = Date.now()
      const reactionEvent = {
        content: emoji,
        kind: KIND_REACTION,
        created_at: Math.floor(now / 1000),
        tags: [
          ["e", messageId],
          ["l", groupId],
          ["ms", String(now)],
        ],
        pubkey: myPubKey,
        id: "",
      }
      reactionEvent.id = getEventHash(reactionEvent)

      await usePrivateMessagesStore.getState().upsert(groupId, myPubKey, reactionEvent)

      Promise.all(
        groupMembers.map((memberPubKey) =>
          sessionManager.sendEvent(memberPubKey, reactionEvent)
        )
      ).catch(console.error)
    }
  }

  const handleScroll = () => {
    const container = chatContainerRef.current
    if (!container) return
    const isBottom =
      container.scrollTop + container.clientHeight >= container.scrollHeight - 1
    setShowScrollDown(!isBottom)
    wasAtBottomRef.current = isBottom
  }

  const scrollToBottom = () => {
    // Use requestAnimationFrame to ensure DOM is updated before scrolling
    requestAnimationFrame(() => {
      // Add a small delay to ensure all content is fully rendered
      setTimeout(() => {
        if (chatContainerRef.current) {
          chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight
        }
      }, 10)
    })
  }

  useLayoutEffect(() => {
    if (wasAtBottomRef.current) scrollToBottom()
  }, [messages.size])

  // Reset render count when total messages decrease (e.g., chat switched)
  useEffect(() => {
    const totalMessages = messages.size
    if (totalMessages < renderCount) {
      setRenderCount(Math.max(INITIAL_RENDER_COUNT, totalMessages))
    }
  }, [messages.size, renderCount])

  useEffect(() => {
    const container = chatContainerRef.current
    if (!container) return

    container.addEventListener("scroll", handleScroll)
    return () => container.removeEventListener("scroll", handleScroll)
  }, [])

  // Handle scroll behavior for new messages and height changes
  useEffect(() => {
    const newMessageCount = messages.size
    const hadNewMessages = newMessageCount > lastMessageCountRef.current
    lastMessageCountRef.current = newMessageCount

    if (hadNewMessages) {
      // Check if the new message is from the user
      const currentMessageIds = new Set(messages.keys())
      const newMessageIds = Array.from(currentMessageIds).filter(
        (id) => !lastMessageIdsRef.current.has(id)
      )

      // If there's a new message and it's from the user, scroll to bottom
      if (newMessageIds.length > 0) {
        const newMessage = messages.get(newMessageIds[0])
        const myPubKey = useUserStore.getState().publicKey
        if (newMessage && newMessage.pubkey === myPubKey) {
          scrollToBottom()
        } else if (wasAtBottomRef.current) {
          // If user was at bottom, keep them there
          scrollToBottom()
        } else {
          // If user was not at bottom, show scroll down button
          setShowScrollDown(true)
        }
      }

      lastMessageIdsRef.current = currentMessageIds
    }
  }, [messages])

  // Setup ResizeObserver to monitor height changes
  useEffect(() => {
    if (chatContainerRef.current) {
      resizeObserverRef.current = new ResizeObserver((entries) => {
        const newHeight = entries[0].contentRect.height
        // Only scroll to bottom if height increased and user was at bottom
        if (newHeight > lastHeightRef.current && wasAtBottomRef.current) {
          scrollToBottom()
        }
        lastHeightRef.current = newHeight
      })
      resizeObserverRef.current.observe(chatContainerRef.current)
    }

    return () => {
      resizeObserverRef.current?.disconnect()
    }
  }, [])

  // Add effect to handle initial scroll when messages first load
  useEffect(() => {
    if (messages.size > 0 && !hasInitiallyScrolledRef.current) {
      // Scroll to bottom on initial load
      scrollToBottom()
      hasInitiallyScrolledRef.current = true
    }
  }, [messages.size])

  return (
    <>
      <div
        ref={chatContainerRef}
        className="flex flex-col flex-1 space-y-4 p-4 relative overflow-y-auto overflow-x-hidden pt-[calc(4rem+env(safe-area-inset-top))] pb-[calc(10rem+env(safe-area-inset-bottom))] md:pt-4 md:pb-4"
        data-header-scroll-target
      >
        {messages.size === 0 ? (
          <>
            <div className="flex-grow" />
            <div className="text-center text-base-content/70 my-8">
              {initialLoadDone && showNoMessages
                ? "No messages yet. Be the first to send a message!"
                : ""}
            </div>
          </>
        ) : (
          <>
            <div className="flex-grow min-h-0" />
            <ReverseVirtualScroll onLoadMore={handleLoadMore} enabled={canLoadMore}>
              {canLoadMore && (
                <div className="text-center text-xs text-base-content/50 py-2">
                  Scroll up to load older messages
                </div>
              )}
              {messageGroups.map((group, index) => {
                const groupTimestamp = getMillisecondTimestamp(group[0])
                const groupDate = formatDayLabel(groupTimestamp)
                const prevGroupTimestamp =
                  index > 0 ? getMillisecondTimestamp(messageGroups[index - 1][0]) : null
                const prevGroupDate = prevGroupTimestamp
                  ? formatDayLabel(prevGroupTimestamp)
                  : null

                return (
                  <div key={index} className="mb-6">
                    {(!prevGroupDate || groupDate !== prevGroupDate) && (
                      <div className="sticky top-0 z-10 flex justify-center py-2 mb-2 pointer-events-none">
                        <span className="px-3 py-1 rounded-full text-xs text-base-content/70 bg-base-200/80 backdrop-blur-md shadow-sm pointer-events-auto">
                          {groupDate}
                        </span>
                      </div>
                    )}
                    <div className="flex flex-col gap-[2px]">
                      <ErrorBoundary>
                        {group.map((message, messageIndex) => (
                          <Message
                            key={message.id}
                            message={message}
                            isFirst={messageIndex === 0}
                            isLast={messageIndex === group.length - 1}
                            sessionId={sessionId}
                            onReply={() => onReply(message)}
                            showAuthor={showAuthor}
                            onSendReaction={handleReaction}
                          />
                        ))}
                      </ErrorBoundary>
                    </div>
                  </div>
                )
              })}
            </ReverseVirtualScroll>
          </>
        )}
        {typingActive && (
          <div className="flex items-end gap-2 mt-1">
            <div className="bg-base-200 rounded-2xl rounded-bl-sm px-3 py-2 flex items-center gap-1">
              <span
                className="w-1.5 h-1.5 rounded-full bg-base-content/50 animate-bounce"
                style={{animationDelay: "0ms"}}
              />
              <span
                className="w-1.5 h-1.5 rounded-full bg-base-content/50 animate-bounce"
                style={{animationDelay: "150ms"}}
              />
              <span
                className="w-1.5 h-1.5 rounded-full bg-base-content/50 animate-bounce"
                style={{animationDelay: "300ms"}}
              />
            </div>
          </div>
        )}
        {bottomContent}
        <div ref={messagesEndRef} />
      </div>
      {showScrollDown && (
        <button
          className="fixed bottom-32 right-4 btn btn-circle btn-neutral btn-sm"
          onClick={scrollToBottom}
        >
          ↓
        </button>
      )}
    </>
  )
}

export default ChatContainer
