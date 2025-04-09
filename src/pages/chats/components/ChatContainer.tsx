import {Session, getMillisecondTimestamp} from "nostr-double-ratchet/src"
import ErrorBoundary from "@/shared/components/ui/ErrorBoundary"
import {groupMessages} from "../utils/messageGrouping"
import {SortedMap} from "@/utils/SortedMap/SortedMap"
import {useEffect, useRef, useState} from "react"
import Message, {MessageType} from "../Message"

interface ChatContainerProps {
  messages: SortedMap<string, MessageType>
  session: Session
  sessionId: string
  onReply: (message: MessageType) => void
  showAuthor?: boolean
  isPublicChat?: boolean
  initialLoadDone?: boolean
  showNoMessages?: boolean
}

const ChatContainer = ({
  messages,
  session,
  sessionId,
  onReply,
  showAuthor = false,
  isPublicChat = false,
  initialLoadDone = false,
  showNoMessages = false,
}: ChatContainerProps) => {
  const [isAtBottom, setIsAtBottom] = useState(true)
  const [showScrollDown, setShowScrollDown] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const chatContainerRef = useRef<HTMLDivElement>(null)

  const messageGroups = groupMessages(messages, undefined, isPublicChat)

  // Scroll to bottom when new messages arrive
  useEffect(() => {
    if (isAtBottom) {
      scrollToBottom()
    } else {
      setShowScrollDown(true)
    }
  }, [messages])

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView()
  }

  const handleScroll = () => {
    if (chatContainerRef.current) {
      const {scrollTop, scrollHeight, clientHeight} = chatContainerRef.current
      const isBottom = scrollTop + clientHeight >= scrollHeight - 10
      setIsAtBottom(isBottom)
      setShowScrollDown(!isBottom)
    }
  }

  return (
    <>
      <div
        ref={chatContainerRef}
        className="flex flex-col justify-end flex-1 overflow-y-auto space-y-4 p-4 relative"
        onScroll={handleScroll}
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
                        session={session}
                        sessionId={sessionId}
                        onReply={() => onReply(message)}
                        showAuthor={showAuthor}
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
          className="btn btn-circle btn-primary fixed bottom-20 right-4"
          onClick={scrollToBottom}
        >
          <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M19 14l-7 7m0 0l-7-7m7 7V3"
            />
          </svg>
        </button>
      )}
    </>
  )
}

export default ChatContainer
