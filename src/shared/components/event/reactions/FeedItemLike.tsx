import {
  MouseEvent as ReactMouseEvent,
  TouchEvent as ReactTouchEvent,
  useEffect,
  useMemo,
  useState,
} from "react"
import {FloatingEmojiPicker} from "@/shared/components/emoji/FloatingEmojiPicker"
import {formatAmount} from "@/utils/utils.ts"
import {NDKEvent} from "@/lib/ndk"
import {useUserStore} from "@/stores/user"
import {useScrollAwareLongPress} from "@/shared/hooks/useScrollAwareLongPress"
import EmojiType from "@/types/emoji"
import Icon from "../../Icons/Icon"
import {useReactionsByAuthor} from "@/shared/hooks/useReactions"
import {getReactionPublishErrorMessage, reactWithExpiration} from "@/utils/reaction"
import {useToastStore} from "@/stores/toast"
import {useGroupAccess} from "@/groups/GroupContext"

export const FeedItemLike = ({
  event,
  showReactionCounts = true,
}: {
  event: NDKEvent
  showReactionCounts?: boolean
}) => {
  const group = useGroupAccess()
  const canParticipate = !group || group.canParticipate
  const myPubKey = useUserStore((state) => state.publicKey)
  const reactionsByAuthor = useReactionsByAuthor(event.id)
  const [optimisticLike, setOptimisticLike] = useState<string | null>(null)

  const handlePublishFailure = (error: unknown) => {
    console.warn(`Could not publish reaction: ${error}`)
    const message = getReactionPublishErrorMessage(error)
    setOptimisticLike(null)
    if (!message && !group) return
    useToastStore
      .getState()
      .addToast(message || "Could not publish reaction. Please try again.", "error")
  }

  const likesByAuthor = useMemo(() => {
    if (!showReactionCounts) return new Set<string>()
    const likesSet = new Set<string>()
    for (const [pubkey] of reactionsByAuthor) {
      likesSet.add(pubkey)
    }
    // Include optimistic like if not already in reactions
    if (canParticipate && optimisticLike && myPubKey && !likesSet.has(myPubKey)) {
      likesSet.add(myPubKey)
    }
    return likesSet
  }, [reactionsByAuthor, showReactionCounts, optimisticLike, myPubKey, canParticipate])

  const myReactionEvent = reactionsByAuthor.get(myPubKey || "")
  const myReaction = myReactionEvent?.content || optimisticLike || "+"

  const [showEmojiPicker, setShowEmojiPicker] = useState(false)
  useEffect(() => {
    if (!canParticipate) {
      setShowEmojiPicker(false)
      setOptimisticLike(null)
    }
  }, [canParticipate])
  const [pickerPosition, setPickerPosition] = useState<{clientY?: number}>({})
  const {
    handleMouseDown: handleLongPressDown,
    handleMouseMove: handleLongPressMove,
    handleMouseUp: handleLongPressUp,
    isLongPress,
  } = useScrollAwareLongPress({
    onLongPress: () => canParticipate && setShowEmojiPicker(true),
  })

  // Custom handler to also set picker position
  const handleMouseDown = (
    e: ReactMouseEvent<HTMLButtonElement> | ReactTouchEvent<HTMLButtonElement>
  ) => {
    if (!myPubKey || !canParticipate) return

    // Set picker position
    if ("touches" in e && e.touches.length > 0) {
      setPickerPosition({clientY: e.touches[0].clientY})
    } else if ("clientY" in e) {
      setPickerPosition({clientY: e.clientY})
    }

    // Delegate to long press handler
    handleLongPressDown(e)
  }

  const like = async () => {
    if (!myPubKey || !canParticipate || reactionsByAuthor.has(myPubKey)) return
    if (!group) setOptimisticLike("+")
    try {
      await reactWithExpiration(event, "+")
      setOptimisticLike("+")
    } catch (error) {
      handlePublishFailure(error)
    }
  }

  const handleEmojiSelect = async (emoji: EmojiType) => {
    if (!myPubKey || !canParticipate) return
    if (!group) setOptimisticLike(emoji.native)
    setShowEmojiPicker(false)
    try {
      await reactWithExpiration(event, emoji.native)
      setOptimisticLike(emoji.native)
    } catch (error) {
      handlePublishFailure(error)
    }
  }

  const handleClick = () => {
    if (!isLongPress) {
      like()
    }
  }

  const liked = likesByAuthor.has(myPubKey)

  const getReactionIcon = () => {
    if (!liked) return <Icon name="heart" size={16} />
    if (myReaction === "+") return <Icon name="heart-solid" size={16} />
    return <span className="text-base leading-none">{myReaction}</span>
  }

  return (
    <button
      title={canParticipate ? "Like" : "Members only"}
      aria-label="Like"
      disabled={!canParticipate}
      data-testid="like-button"
      className={`disabled:opacity-40 disabled:cursor-not-allowed relative min-w-[50px] md:min-w-[80px] transition-colors duration-200 ease-in-out cursor-pointer likeIcon ${
        liked ? "text-error" : "hover:text-error"
      } flex flex-row gap-1 items-center`}
      onClick={handleClick}
      onMouseDown={(e) => handleMouseDown(e)}
      onMouseMove={(e) => handleLongPressMove(e)}
      onMouseUp={handleLongPressUp}
      onMouseLeave={handleLongPressUp}
      onTouchStart={(e) => handleMouseDown(e)}
      onTouchMove={(e) => handleLongPressMove(e)}
      onTouchEnd={handleLongPressUp}
    >
      {getReactionIcon()}
      <span data-testid="like-count">
        {showReactionCounts ? formatAmount(likesByAuthor.size) : ""}
      </span>

      <FloatingEmojiPicker
        isOpen={showEmojiPicker}
        onClose={() => setShowEmojiPicker(false)}
        onEmojiSelect={handleEmojiSelect}
        position={pickerPosition}
      />
    </button>
  )
}
