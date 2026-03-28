import {NDKEvent, NDKFilter} from "@/lib/ndk"
import {shouldHideEvent} from "@/utils/visibility"
import {useEffect, useState} from "react"
import debounce from "lodash/debounce"
import {ndk} from "@/utils/ndk"

import Modal from "@/shared/components/ui/Modal.tsx"
import {formatAmount} from "@/utils/utils.ts"
import {useUserStore} from "@/stores/user"
import Icon from "../../Icons/Icon"

import NoteCreator from "@/shared/components/create/NoteCreator.tsx"
import {LRUCache} from "typescript-lru-cache"
import {
  buildReplySubscriptionFilters,
  getEventReplyReference,
  getEventRootReference,
} from "@/utils/threadReferences"

interface FeedItemCommentProps {
  event: NDKEvent
  showReactionCounts?: boolean
}

const replyCountByEventCache = new LRUCache({maxSize: 100})

function FeedItemComment({event, showReactionCounts = true}: FeedItemCommentProps) {
  const myPubKey = useUserStore((state) => state.publicKey)
  const threadReference = event.tagId()
  const [replyCount, setReplyCount] = useState(
    replyCountByEventCache.get(threadReference) || 0
  )

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
    setReplyCount(replyCountByEventCache.get(threadReference) || 0)
    const filters: NDKFilter[] = buildReplySubscriptionFilters(event)

    const debouncedSetReplyCount = debounce((count) => {
      setReplyCount(count)
      replyCountByEventCache.set(threadReference, count)
    }, 300)

    try {
      // Closed on eose because NDK will otherwise send too many concurrent REQs for all the feed item reaction subscriptions
      const subs = filters.map((filter) => ndk().subscribe(filter, {closeOnEose: true}))

      subs.forEach((sub) =>
        sub?.on("event", (e: NDKEvent) => {
          if (shouldHideEvent(e)) return
          if (
            getEventRootReference(e) !== threadReference &&
            getEventReplyReference(e) !== threadReference
          )
            return

          replies.add(e.id)
          debouncedSetReplyCount(replies.size)
        })
      )

      return () => {
        subs.forEach((sub) => sub.stop())
        debouncedSetReplyCount.cancel()
      }
    } catch (error) {
      console.warn(error)
    }
  }, [event, showReactionCounts, threadReference])

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
