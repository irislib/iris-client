import {useLayoutEffect, useRef, useState, useEffect} from "react"
import ErrorBoundary from "@/shared/components/ui/ErrorBoundary"
import {getMillisecondTimestamp} from "nostr-double-ratchet/src"
import Message, {MessageType} from "../message/Message"
import {groupMessages} from "../utils/messageGrouping"
import {SortedMap} from "@/utils/SortedMap/SortedMap"

interface ChatContainerProps {
  messages: SortedMap<string, MessageType>
  sessionId: string
  onReply: (message: MessageType) => void
  showAuthor?: boolean
  isPublicChat?: boolean
  initialLoadDone?: boolean
  showNoMessages?: boolean
  onSendReaction?: (messageId: string, emoji: string) => Promise<void>
}

const root = document.documentElement

const ChatContainer = ({
  messages,
  sessionId,
  onReply,
  showAuthor = false,
  isPublicChat = false,
  initialLoadDone = false,
  showNoMessages = false,
  onSendReaction,
}: ChatContainerProps) => {
  const [showScrollDown, setShowScrollDown] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const chatContainerRef = useRef<HTMLDivElement>(null)
  const wasAtBottomRef = useRef(true)
  const lastMessageCountRef = useRef(messages.size)
  const lastMessageIdsRef = useRef<Set<string>>(new Set())
  const resizeObserverRef = useRef<ResizeObserver | null>(null)
  const lastHeightRef = useRef(0)

  const messageGroups = groupMessages(messages, undefined, isPublicChat)

  const handleScroll = () => {
    const isBottom = root.scrollTop + root.clientHeight >= root.scrollHeight - 1
    setShowScrollDown(!isBottom)
    wasAtBottomRef.current = isBottom
  }

  const scrollToBottom = () => {
    root.scrollTop = root.scrollHeight
  }

  useLayoutEffect(() => {
    if (wasAtBottomRef.current) scrollToBottom()
  }, [messages.size])

  useEffect(() => {
    window.addEventListener("scroll", handleScroll)
    return () => window.removeEventListener("scroll", handleScroll)
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
        if (newMessage && newMessage.sender === "user") {
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

  return (
    <>
      <div
        ref={chatContainerRef}
        className="flex flex-col justify-end flex-1 space-y-4 p-4 relative"
      >
        {messages.size === 0 ? (
          <div className="text-center text-base-content/70 my-8">
            {initialLoadDone && showNoMessages
              ? "No messages yet. Be the first to send a message!"
              : ""}
          </div>
        ) : (
          messageGroups.map((group, index) => {
            const groupDate = new Date(getMillisecondTimestamp(group[0])).toDateString()
            const prevGroupDate =
              index > 0
                ? new Date(
                    getMillisecondTimestamp(messageGroups[index - 1][0])
                  ).toDateString()
                : null

            return (
              <div key={index} className="mb-6">
                {(!prevGroupDate || groupDate !== prevGroupDate) && (
                  <div className="text-xs text-base-content/50 text-center mb-4">
                    {groupDate}
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
                        onSendReaction={onSendReaction}
                      />
                    ))}
                  </ErrorBoundary>
                </div>
              </div>
            )
          })
        )}
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
