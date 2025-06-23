import {getMillisecondTimestamp, Rumor} from "nostr-double-ratchet/src"
import MessageReactionButton from "../reaction/MessageReactionButton"
import MessageReactions from "../reaction/MessageReactions"
import {Avatar} from "@/shared/components/user/Avatar"
import HyperText from "@/shared/components/HyperText"
import {shouldHideAuthor} from "@/utils/visibility"
import {Name} from "@/shared/components/user/Name"
import {useMemo, useEffect, useState} from "react"
import {useEventsStore} from "@/stores/events"
import ReplyPreview from "./ReplyPreview"
import classNames from "classnames"
import {Link} from "react-router"
import {nip19} from "nostr-tools"
import {ndk} from "@/utils/ndk"

export type MessageType = Rumor & {
  sender?: "user"
  reactions?: Record<string, string>
}

type MessageProps = {
  message: MessageType
  isFirst: boolean
  isLast: boolean
  sessionId: string
  onReply?: () => void
  showAuthor?: boolean
  onSendReaction?: (messageId: string, emoji: string) => Promise<void>
  reactions?: Record<string, string>
}

// Moved regex outside component to avoid recreation on each render
const EMOJI_REGEX =
  /^(\p{Extended_Pictographic}|[\u{1F3FB}-\u{1F3FF}]|\p{Emoji_Component}|\u200D|[\u{E0020}-\u{E007F}])+$/u

// Extracted time formatting logic
const formatMessageTime = (timestamp: number): string => {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "numeric",
    hour12: undefined,
  }).format(new Date(timestamp))
}

// Extracted className generation logic
const getMessageClassName = (
  isUser: boolean,
  isFirst: boolean,
  isLast: boolean,
  isShortEmoji: boolean
) => {
  return classNames(
    !isShortEmoji &&
      (isUser ? "bg-primary text-primary-content" : "bg-neutral text-neutral-content"),
    isShortEmoji && "bg-transparent",
    isFirst && isLast && "rounded-2xl",
    isFirst &&
      !isLast &&
      (isUser
        ? "rounded-t-2xl rounded-bl-2xl rounded-br-sm"
        : "rounded-t-2xl rounded-br-2xl rounded-bl-sm"),
    !isFirst &&
      isLast &&
      (isUser
        ? "rounded-b-2xl rounded-tl-2xl rounded-tr-sm"
        : "rounded-b-2xl rounded-tr-2xl rounded-tl-sm"),
    !isFirst &&
      !isLast &&
      (isUser ? "rounded-l-2xl rounded-r-sm" : "rounded-r-2xl rounded-l-sm")
  )
}

const Message = ({
  message,
  isFirst,
  isLast,
  sessionId,
  onReply,
  showAuthor = false,
  onSendReaction,
  reactions: propReactions,
}: MessageProps) => {
  const isUser = message.sender === "user"
  const {events} = useEventsStore()
  const [localReactions, setLocalReactions] = useState<Record<string, string>>(
    propReactions || {}
  )
  const isShortEmoji = useMemo(
    () => EMOJI_REGEX.test(message.content?.trim() ?? ""),
    [message.content]
  )

  const sessionReactions = events.get(sessionId)?.get(message.id)?.reactions || {}

  // Set up reaction subscription
  useEffect(() => {
    const filter = {
      kinds: [7], // REACTION_KIND
      "#e": [message.id],
    }

    const sub = ndk().subscribe(filter)

    sub.on("event", (reactionEvent) => {
      if (!reactionEvent || !reactionEvent.id) return
      if (shouldHideAuthor(reactionEvent.pubkey)) return

      setLocalReactions((prev) => ({
        ...prev,
        [reactionEvent.pubkey]: reactionEvent.content,
      }))
    })

    return () => {
      sub.stop()
    }
  }, [message.id])

  const repliedId = useMemo(() => {
    // First check for explicit reply tag
    const replyTag = message.tags?.find(
      (tag) => tag[0] === "e" && tag[3] === "reply"
    )?.[1]
    if (replyTag) return replyTag

    // If no explicit reply tag, check if there's an "e" tag but no "root" tag
    const hasETag = message.tags?.some((tag) => tag[0] === "e")
    const hasRootTag = message.tags?.some((tag) => tag[0] === "e" && tag[3] === "root")

    if (hasETag && !hasRootTag) {
      // Return the first "e" tag's value as the reply ID
      return message.tags?.find((tag) => tag[0] === "e")?.[1]
    }

    return undefined
  }, [message.tags])

  const messageClassName = useMemo(
    () => getMessageClassName(isUser, isFirst, isLast, isShortEmoji),
    [isUser, isFirst, isLast, isShortEmoji]
  )

  const formattedTime = useMemo(
    () => formatMessageTime(getMillisecondTimestamp(message)),
    [message]
  )

  return (
    <div
      className={classNames(
        "group relative w-full flex",
        isUser ? "justify-end" : "justify-start"
      )}
      id={message.id}
    >
      <div className="flex items-center justify-center gap-2">
        {isUser && (
          <MessageReactionButton
            messageId={message.id}
            sessionId={sessionId}
            isUser={isUser}
            onReply={onReply}
            onSendReaction={onSendReaction}
          />
        )}

        <div className="flex flex-col">
          {showAuthor && !isUser && isFirst && (
            <Link
              to={`/${nip19.npubEncode(message.pubkey)}`}
              className="flex items-center gap-2 mb-1 ml-1"
            >
              <Avatar pubKey={message.pubkey} width={24} showBadge={true} />
              <Name pubKey={message.pubkey} className="text-xs font-medium" />
            </Link>
          )}
          <div className={messageClassName}>
            {repliedId && (
              <ReplyPreview isUser={isUser} sessionId={sessionId} replyToId={repliedId} />
            )}
            <div
              className={classNames(
                "px-3 py-2",
                isLast && "flex justify-between items-end",
                isShortEmoji && "flex-col gap-1 items-center"
              )}
            >
              <p
                className={classNames(
                  isShortEmoji ? "text-6xl" : "text-sm",
                  "whitespace-pre-wrap break-words [overflow-wrap:anywhere]"
                )}
              >
                <HyperText small={true} truncate={500}>
                  {message.content}
                </HyperText>
              </p>
              {isLast && (
                <p className="text-xs opacity-50 ml-2 whitespace-nowrap">
                  {formattedTime}
                </p>
              )}
            </div>
          </div>

          <MessageReactions
            rawReactions={
              Object.keys(sessionReactions).length <= 0
                ? localReactions
                : sessionReactions
            }
            isUser={isUser}
          />
        </div>

        {!isUser && (
          <MessageReactionButton
            messageId={message.id}
            sessionId={sessionId}
            isUser={isUser}
            onReply={onReply}
            onSendReaction={onSendReaction}
          />
        )}
      </div>
    </div>
  )
}

export default Message
