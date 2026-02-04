import {FloatingEmojiPicker} from "@/shared/components/emoji/FloatingEmojiPicker"
import {RiHeartAddLine, RiReplyLine} from "@remixicon/react"
// import {useSessionsStore} from "@/stores/sessions" // TEMP: Removed
import {MouseEvent, useState} from "react"
import classNames from "classnames"
import {KIND_REACTION, DEBUG_NAMESPACES} from "@/utils/constants"
import {MessageDropdown} from "./MessageDropdown"
import {MessageInfoModal} from "./MessageInfoModal"
import {createDebugLogger} from "@/utils/createDebugLogger"

const {log} = createDebugLogger(DEBUG_NAMESPACES.UI_CHAT)

type MessageActionButtonsProps = {
  messageId: string
  sessionId: string
  isUser: boolean
  onReply?: () => void
  onSendReaction?: (messageId: string, emoji: string) => Promise<void>
  nostrEventId?: string
  message?: {
    created_at?: number
    tags?: string[][]
    content?: string
  }
}

type EmojiData = {
  native: string
  [key: string]: unknown
}

const MessageActionButtons = ({
  messageId,
  sessionId,
  isUser,
  onReply,
  onSendReaction,
  nostrEventId,
  message,
}: MessageActionButtonsProps) => {
  // TEMP: Dummy sendMessage function
  const sendMessage = async (sessionId: string, event: unknown) => {
    log("TEMP: sendMessage called but not implemented", sessionId, event)
  }
  const [showReactionsPicker, setShowReactionsPicker] = useState(false)
  const [pickerPosition, setPickerPosition] = useState<{
    clientY?: number
    clientX?: number
  }>({})
  const [showInfoModal, setShowInfoModal] = useState(false)

  const handleReactionClick = (e: MouseEvent) => {
    const buttonRect = e.currentTarget.getBoundingClientRect()
    setPickerPosition({
      clientY: buttonRect.top,
      clientX: buttonRect.right,
    })
    setShowReactionsPicker(!showReactionsPicker)
  }

  const handleEmojiClick = (emoji: EmojiData) => {
    setShowReactionsPicker(false)
    if (onSendReaction) {
      // Use the provided onSendReaction function if available
      onSendReaction(messageId, emoji.native)
    } else {
      // Construct a reaction event
      // Use the message ID which is already the canonical ID
      const reactionTargetId = messageId
      const event = {
        content: emoji.native,
        kind: KIND_REACTION,
        tags: [["e", reactionTargetId]],
      }
      sendMessage(sessionId, event)
    }
  }

  const handleInfoClick = () => {
    setShowInfoModal(true)
  }

  return (
    <div className="relative -mb-1">
      <div
        className={classNames("flex items-center", {
          "flex-row-reverse": !isUser,
        })}
      >
        {onReply && (
          <div
            data-testid="reply-button"
            className="p-1 md:p-2 text-base-content/50 rounded-full opacity-0 group-hover:opacity-100 cursor-pointer transition-opacity flex-shrink-0"
            onClick={onReply}
          >
            <RiReplyLine className="w-5 h-5 md:w-6 md:h-6" />
          </div>
        )}
        <div
          data-testid="reaction-button"
          role="button"
          aria-label="Add reaction"
          className="p-1 md:p-2 text-base-content/50 rounded-full opacity-0 group-hover:opacity-100 cursor-pointer transition-opacity flex-shrink-0"
          onClick={handleReactionClick}
        >
          <RiHeartAddLine className="w-5 h-5 md:w-6 md:h-6" />
        </div>
        <MessageDropdown
          messageId={messageId}
          sessionId={sessionId}
          isUser={isUser}
          onInfoClick={handleInfoClick}
          messageContent={message?.content}
        />
      </div>

      {showReactionsPicker && (
        <div className="absolute inset-0 pointer-events-none">
          <FloatingEmojiPicker
            isOpen={showReactionsPicker}
            onClose={() => setShowReactionsPicker(false)}
            onEmojiSelect={handleEmojiClick}
            position={{
              clientY: pickerPosition.clientY,
              clientX: pickerPosition.clientX,
              openRight: isUser,
            }}
          />
        </div>
      )}

      <MessageInfoModal
        isOpen={showInfoModal}
        onClose={() => setShowInfoModal(false)}
        nostrEventId={nostrEventId}
        sessionId={sessionId}
        messageId={messageId}
        message={message}
      />
    </div>
  )
}

export default MessageActionButtons
