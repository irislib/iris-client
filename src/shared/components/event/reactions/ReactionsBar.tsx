import {NDKEvent} from "@/lib/ndk"
import {useMemo, ReactNode, useRef, useState} from "react"
import ProxyImg from "@/shared/components/ProxyImg"
import {Name} from "@/shared/components/user/Name"
import {useUserStore} from "@/stores/user"
import {useReactions, ReactionInfo} from "@/shared/hooks/useReactions"
import {getReactionPublishErrorMessage, reactWithExpiration} from "@/utils/reaction"
import {useToastStore} from "@/stores/toast"

interface ReactionsBarProps {
  event: NDKEvent
}

export default function ReactionsBar({event}: ReactionsBarProps) {
  const reactions = useReactions(event.id)

  // Sort reactions by count
  const sortedReactions = Array.from(reactions.values()).sort(
    (a, b) => b.pubkeys.size - a.pubkeys.size
  )

  // Helper to render emoji content
  const renderEmoji = (reaction: ReactionInfo) => {
    const {emoji, isCustom, emojiUrl} = reaction

    if (emoji === "+") return "❤️"

    // If it's a custom emoji with URL, render the image
    if (isCustom && emojiUrl) {
      return (
        <ProxyImg
          width={20}
          src={emojiUrl}
          alt={emoji}
          className="inline-block h-5 w-5 object-contain"
        />
      )
    }

    // Check if it looks like a custom emoji shortcode that wasn't matched
    if (emoji.startsWith(":") && emoji.endsWith(":")) {
      // Return the shortcode as text if no URL was found
      return emoji
    }

    // Default emoji rendering
    return emoji
  }

  return (
    <div className="relative">
      <div className="flex gap-2 overflow-x-auto py-2 scrollbar-thin min-h-[38px]">
        {reactions.size === 0 ? (
          // Invisible placeholder with same height as actual elements
          <div className="flex-shrink-0 px-3 py-1.5 opacity-0">
            <span className="text-sm">❤️ 0</span>
          </div>
        ) : (
          sortedReactions.map((reaction, index) => (
            <ReactionItem
              key={reaction.emojiUrl || reaction.emoji || index}
              reaction={reaction}
              renderEmoji={renderEmoji}
              event={event}
            />
          ))
        )}
      </div>
    </div>
  )
}

interface ReactionItemProps {
  reaction: ReactionInfo
  renderEmoji: (reaction: ReactionInfo) => ReactNode
  event: NDKEvent
}

function ReactionItem({reaction, renderEmoji, event}: ReactionItemProps) {
  const [showTooltip, setShowTooltip] = useState(false)
  const [tooltipPosition, setTooltipPosition] = useState({top: 0, left: 0})
  const buttonRef = useRef<HTMLButtonElement>(null)
  const pubkeysArray = useMemo(() => Array.from(reaction.pubkeys), [reaction.pubkeys])
  const myPubKey = useUserStore((state) => state.publicKey)

  const handleMouseEnter = () => {
    if (buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect()
      setTooltipPosition({
        top: rect.top - 10,
        left: rect.left + rect.width / 2,
      })
      setShowTooltip(true)
    }
  }

  const handleMouseLeave = () => {
    setShowTooltip(false)
  }

  const handleClick = async () => {
    if (!myPubKey) return

    try {
      // Send reaction with the same emoji
      const emojiToSend = reaction.emoji

      // Handle custom emoji - send in :shortcode: format
      if (reaction.isCustom && reaction.event) {
        const customEmojiMatch = reaction.emoji.match(/^:([a-zA-Z0-9_-]+):$/)
        if (customEmojiMatch) {
          const shortcode = customEmojiMatch[1]
          const emojiTag = reaction.event.tags.find(
            (tag) => tag[0] === "emoji" && tag[1] === shortcode
          )
          if (emojiTag) {
            // Create a new event with custom emoji tags
            const reactionEvent = await reactWithExpiration(event, reaction.emoji)
            if (reactionEvent && emojiTag[2]) {
              // Add emoji tag to the reaction event
              reactionEvent.tags.push(["emoji", shortcode, emojiTag[2]])
              await reactionEvent.publish()
              return
            }
          }
        }
      }

      // For regular emojis and "+"
      await reactWithExpiration(event, emojiToSend)
    } catch (error) {
      console.warn(`Could not publish reaction: ${error}`)
      const message = getReactionPublishErrorMessage(error)
      if (message) useToastStore.getState().addToast(message, "error")
    }
  }

  const maxToShow = 10
  const toShow = pubkeysArray.slice(0, maxToShow)
  const remaining = pubkeysArray.length - maxToShow

  const hasReacted = myPubKey && reaction.pubkeys.has(myPubKey)

  return (
    <>
      <button
        ref={buttonRef}
        className={`flex-shrink-0 flex items-center gap-2 px-3 py-1.5 rounded-full border text-sm cursor-pointer transition-all ${
          hasReacted
            ? "bg-primary/20 border-primary/30 text-primary"
            : "bg-base-content/5 border-base-content/10 hover:bg-base-content/10"
        }`}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onClick={handleClick}
        disabled={!myPubKey}
      >
        <span className="text-base align-middle">{renderEmoji(reaction)}</span>
        <span className="font-semibold">{reaction.pubkeys.size}</span>
      </button>
      {showTooltip && (
        <div
          className="fixed px-3 py-2 bg-neutral text-neutral-content rounded-lg shadow-xl text-sm z-[9999] pointer-events-none"
          style={{
            top: `${tooltipPosition.top}px`,
            left: `${tooltipPosition.left}px`,
            transform: "translate(-50%, -100%)",
          }}
        >
          <div className="flex flex-wrap gap-x-1 max-w-xs">
            {toShow.map((pubkey, index) => (
              <span key={pubkey} className="whitespace-nowrap">
                <Name pubKey={pubkey} />
                {index < toShow.length - 1 && ", "}
              </span>
            ))}
            {remaining > 0 && (
              <span className="whitespace-nowrap opacity-75">+{remaining} more</span>
            )}
          </div>
        </div>
      )}
    </>
  )
}
