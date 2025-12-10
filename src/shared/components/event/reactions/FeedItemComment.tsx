import {NDKEvent, NDKFilter} from "@/lib/ndk"
import {shouldHideUser} from "@/utils/visibility"
import {useEffect, useState} from "react"
import debounce from "lodash/debounce"
import {ndk} from "@/utils/ndk"

import Modal from "@/shared/components/ui/Modal.tsx"
import {formatAmount} from "@/utils/utils.ts"
import {useUserStore} from "@/stores/user"
import Icon from "../../Icons/Icon"

import NoteCreator from "@/shared/components/create/NoteCreator.tsx"
import {getEventReplyingTo, getEventRoot} from "@/utils/nostr"
import {LRUCache} from "typescript-lru-cache"
import {KIND_TEXT_NOTE} from "@/utils/constants"

interface FeedItemCommentProps {
  event: NDKEvent
  showReactionCounts?: boolean
}

const replyCountByEventCache = new LRUCache({maxSize: 100})

function FeedItemComment({event, showReactionCounts = true}: FeedItemCommentProps) {
  const myPubKey = useUserStore((state) => state.publicKey)
  const [replyCount, setReplyCount] = useState(replyCountByEventCache.get(event.id) || 0)

  const [isPopupOpen, setPopupOpen] = useState(false)

  const handleCommentClick = () => {
    myPubKey && setPopupOpen(!isPopupOpen)
  }

  const handlePopupClose = () => {
    setPopupOpen(false)
  }

  // refetch when location.pathname changes
  // to refetch count when switching display profile
  useEffect(() => {
    if (!showReactionCounts) return

    const replies = new Set<string>()
    setReplyCount(replyCountByEventCache.get(event.id) || 0)
    const filter: NDKFilter = {
      kinds: [KIND_TEXT_NOTE],
      ["#e"]: [event.id],
    }

    const debouncedSetReplyCount = debounce((count) => {
      setReplyCount(count)
      replyCountByEventCache.set(event.id, count)
    }, 300)

    try {
      // Closed on eose because NDK will otherwise send too many concurrent REQs for all the feed item reaction subscriptions
      const sub = ndk().subscribe(filter, {closeOnEose: true})

      sub?.on("event", (e: NDKEvent) => {
        if (shouldHideUser(e.author.pubkey)) return
        // Count if this event has current as root or is replying to it
        if (getEventRoot(e) !== event.id && getEventReplyingTo(e) !== event.id) return
        replies.add(e.id)
        debouncedSetReplyCount(replies.size)
      })

      return () => {
        sub.stop()
        debouncedSetReplyCount.cancel()
      }
    } catch (error) {
      console.warn(error)
    }
  }, [event.id, showReactionCounts])

  return (
    <>
      <button
        title="Reply"
        className="flex flex-row items-center min-w-[50px] md:min-w-[80px] items-center gap-1 cursor-pointer hover:text-info transition-colors duration-200 ease-in-out"
        onClick={handleCommentClick}
      >
        <Icon name="reply" size={16} />
        {showReactionCounts ? formatAmount(replyCount) : ""}
      </button>

      {isPopupOpen && (
        <Modal onClose={handlePopupClose} hasBackground={false}>
          <div
            className="w-[600px] max-w-[90vw] rounded-2xl bg-base-100"
            onClick={(e) => e.stopPropagation()}
          >
            <NoteCreator repliedEvent={event} handleClose={handlePopupClose} />
          </div>
        </Modal>
      )}
    </>
  )
}

export default FeedItemComment
