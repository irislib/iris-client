import {getMillisecondTimestamp, Rumor} from "nostr-double-ratchet/src"
import MessageActionButtons from "../reaction/MessageActionButtons"
import MessageReactions from "../reaction/MessageReactions"
import {Avatar} from "@/shared/components/user/Avatar"
import HyperText from "@/shared/components/HyperText"
import {shouldHideUser} from "@/utils/visibility"
import {Name} from "@/shared/components/user/Name"
import {useMemo, useEffect, useState} from "react"
import {usePrivateMessagesStore} from "@/stores/privateMessages"
import ReplyPreview from "./ReplyPreview"
import classNames from "classnames"
import {Link} from "@/navigation"
import {nip19} from "nostr-tools"
import {ndk} from "@/utils/ndk"
import {KIND_CHANNEL_CREATE, KIND_REACTION} from "@/utils/constants"
import {UserRow} from "@/shared/components/user/UserRow"
import {EMOJI_REGEX} from "@/utils/validation"
import {useUserStore} from "@/stores/user"

export type MessageType = Rumor & {
  reactions?: Record<string, string>
  nostrEventId?: string
  sentToRelays?: boolean
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
  const myPubKey = useUserStore.getState().publicKey
  const isUser = message.pubkey === myPubKey
  const {events} = usePrivateMessagesStore()
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
      kinds: [KIND_REACTION],
      "#e": [message.id],
    }

    const sub = ndk().subscribe(filter)

    sub.on("event", (reactionEvent) => {
      if (!reactionEvent || !reactionEvent.id) return
      if (shouldHideUser(reactionEvent.pubkey)) return

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

  if (message.kind === KIND_CHANNEL_CREATE) {
    console.log("invite", message)
    let content = null
    if (message.pubkey === myPubKey) {
      content = "You created the group"
    } else {
      content = (
        <>
          <UserRow pubKey={message.pubkey} showBadge={true} avatarWidth={24} />
          <span>added you to the group</span>
        </>
      )
    }
    return (
      <div className="flex items-center p-4 bg-base-200 rounded-xl my-2 justify-center text-sm">
        {content}
      </div>
    )
  }

  return (
    <div
      className={classNames(
        "group relative w-full flex min-w-0",
        isUser ? "justify-end" : "justify-start",
        isUser ? "pr-2" : "pl-2"
      )}
      id={message.id}
    >
      <div
        className={classNames(
          "flex items-center justify-center gap-2",
          isUser ? "max-w-[calc(100%-3rem)]" : "max-w-[calc(100%-1rem)]"
        )}
      >
        {isUser && (
          <MessageActionButtons
            messageId={message.id}
            sessionId={sessionId}
            isUser={isUser}
            onReply={onReply}
            onSendReaction={onSendReaction}
            nostrEventId={message.nostrEventId}
            message={message}
          />
        )}

        <div className="flex flex-col min-w-0">
          {showAuthor && !isUser && isFirst && (
            <Link
              to={`/${nip19.npubEncode(message.pubkey)}`}
              className="flex items-center gap-2 mb-1 ml-1 max-w-[60vw] md:max-w-xs"
            >
              <Avatar pubKey={message.pubkey} width={24} showBadge={true} />
              <Name pubKey={message.pubkey} className="text-xs font-medium truncate" />
            </Link>
          )}
          <div className={classNames(messageClassName, "max-w-[70vw] md:max-w-md")}>
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
              <div className="flex items-center gap-1 min-w-0">
                <div
                  className={classNames(
                    isShortEmoji ? "text-6xl" : "text-sm",
                    "whitespace-pre-wrap break-words [overflow-wrap:anywhere] min-w-0"
                  )}
                >
                  <HyperText small={true} truncate={500} event={message}>
                    {message.content}
                  </HyperText>
                </div>
              </div>
              {isLast && (
                <div className="flex items-center gap-1 ml-2">
                  <p className="text-xs opacity-50 whitespace-nowrap">{formattedTime}</p>
                </div>
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
          <MessageActionButtons
            messageId={message.id}
            sessionId={sessionId}
            isUser={isUser}
            onReply={onReply}
            onSendReaction={onSendReaction}
            nostrEventId={message.nostrEventId}
            message={message}
          />
        )}
      </div>
    </div>
  )
}

export default Message
