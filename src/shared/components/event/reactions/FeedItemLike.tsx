import {
  MouseEvent as ReactMouseEvent,
  TouchEvent as ReactTouchEvent,
  useEffect,
  useState,
  useRef,
} from "react"
import {FloatingEmojiPicker} from "@/shared/components/emoji/FloatingEmojiPicker"
import {shouldHideAuthor} from "@/utils/visibility"
import {LRUCache} from "typescript-lru-cache"
import {formatAmount} from "@/utils/utils.ts"
import {NDKEvent} from "@nostr-dev-kit/ndk"
import {useUserStore} from "@/stores/user"
import debounce from "lodash/debounce"
import EmojiType from "@/types/emoji"
import Icon from "../../Icons/Icon"
import {ndk} from "@/utils/ndk"
import {useSettingsStore} from "@/stores/settings"

const likeCache = new LRUCache<string, Set<string>>({
  maxSize: 100,
})

export const FeedItemLike = ({event}: {event: NDKEvent}) => {
  const {content} = useSettingsStore()
  const myPubKey = useUserStore((state) => state.publicKey)
  const cachedLikes = likeCache.get(event.id)
  const [likesByAuthor, setLikesByAuthor] = useState<Set<string>>(
    cachedLikes || new Set()
  )
  const [likeCount, setLikeCount] = useState(likesByAuthor.size)
  const [myReaction, setMyReaction] = useState<string>("+")
  const [showEmojiPicker, setShowEmojiPicker] = useState(false)
  const [pickerPosition, setPickerPosition] = useState<{clientY?: number}>({})
  const longPressTimeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const [isLongPress, setIsLongPress] = useState(false)

  const like = async () => {
    if (likesByAuthor.has(myPubKey)) return
    try {
      event.react("+")
      setMyReaction("+")
      setLikesByAuthor((prev) => {
        const newSet = new Set(prev)
        newSet.add(myPubKey)
        likeCache.set(event.id, newSet)
        setLikeCount(newSet.size)
        return newSet
      })
    } catch (error) {
      console.warn(`Could not publish reaction: ${error}`)
    }
  }

  const handleEmojiSelect = async (emoji: EmojiType) => {
    if (!myPubKey) return
    try {
      await event.react(emoji.native)
      setMyReaction(emoji.native)
      setShowEmojiPicker(false)
      setLikesByAuthor((prev) => {
        const newSet = new Set(prev)
        newSet.add(myPubKey)
        likeCache.set(event.id, newSet)
        setLikeCount(newSet.size)
        return newSet
      })
    } catch (error) {
      console.warn(`Could not publish reaction: ${error}`)
    }
  }

  const handleMouseDown = (
    e: ReactMouseEvent<HTMLButtonElement> | ReactTouchEvent<HTMLButtonElement>
  ) => {
    setIsLongPress(false)
    if ("touches" in e && e.touches.length > 0) {
      setPickerPosition({clientY: e.touches[0].clientY})
    } else if ("clientY" in e) {
      setPickerPosition({clientY: e.clientY})
    }
    longPressTimeout.current = setTimeout(() => {
      setIsLongPress(true)
      setShowEmojiPicker(true)
    }, 500)
  }

  const handleMouseUp = () => {
    if (longPressTimeout.current) {
      clearTimeout(longPressTimeout.current)
    }
  }

  const handleClick = () => {
    if (!isLongPress) {
      like()
    }
  }

  useEffect(() => {
    if (!content.showReactionCounts) return

    const filter = {
      kinds: [7],
      ["#e"]: [event.id],
    }

    try {
      const sub = ndk().subscribe(filter)
      const debouncedUpdate = debounce((likesSet: Set<string>) => {
        setLikeCount(likesSet.size)
      }, 300)

      sub?.on("event", (likeEvent: NDKEvent) => {
        if (shouldHideAuthor(likeEvent.author.pubkey)) return
        if (likeEvent.pubkey === myPubKey) {
          setMyReaction(likeEvent.content)
        }
        setLikesByAuthor((prev) => {
          const newSet = new Set(prev)
          newSet.add(likeEvent.pubkey)
          likeCache.set(event.id, newSet)
          debouncedUpdate(newSet)
          return newSet
        })
      })

      return () => {
        sub.stop()
        debouncedUpdate.cancel()
      }
    } catch (error) {
      console.warn(error)
    }
  }, [content.showReactionCounts])

  const liked = likesByAuthor.has(myPubKey)

  const getReactionIcon = () => {
    if (!liked) return <Icon name="heart" size={16} />
    if (myReaction === "+") return <Icon name="heart-solid" size={16} />
    return <span className="text-base leading-none">{myReaction}</span>
  }

  return (
    <button
      title="Like"
      data-testid="like-button"
      className={`relative min-w-[50px] md:min-w-[80px] transition-colors duration-200 ease-in-out cursor-pointer likeIcon ${
        liked ? "text-error" : "hover:text-error"
      } flex flex-row gap-1 items-center`}
      onClick={handleClick}
      onMouseDown={(e) => handleMouseDown(e)}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onTouchStart={(e) => handleMouseDown(e)}
      onTouchEnd={handleMouseUp}
    >
      {getReactionIcon()}
      <span data-testid="like-count">
        {content.showReactionCounts ? formatAmount(likeCount) : ""}
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
