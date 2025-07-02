import {sharedSubscriptionManager} from "@/utils/sharedSubscriptions"
import {NDKEvent, NDKFilter} from "@nostr-dev-kit/ndk"
import {useEffect, useState} from "react"

import Modal from "@/shared/components/ui/Modal.tsx"
import {formatAmount} from "@/utils/utils.ts"
import {useUserStore} from "@/stores/user"
import Icon from "../../Icons/Icon"

import NoteCreator from "@/shared/components/create/NoteCreator.tsx"
import {getEventReplyingTo} from "@/utils/nostr"
import {LRUCache} from "typescript-lru-cache"

interface FeedItemCommentProps {
  event: NDKEvent
}

const replyCountByEventCache = new LRUCache({maxSize: 100})

function FeedItemComment({event}: FeedItemCommentProps) {
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
    const replies = new Set<string>()
    setReplyCount(replyCountByEventCache.get(event.id) || 0)
    const filter: NDKFilter = {
      kinds: [1],
      ["#e"]: [event.id],
    }

    try {
      const unsubscribe = sharedSubscriptionManager.subscribe(filter, (e: NDKEvent) => {
        if (getEventReplyingTo(e) !== event.id) return
        replies.add(e.id)
        setReplyCount(replies.size)
        replyCountByEventCache.set(event.id, replies.size)
      })

      return unsubscribe
    } catch (error) {
      console.warn(error)
    }
  }, [event.id])

  return (
    <>
      <button
        title="Reply"
        className="flex flex-row items-center min-w-[50px] md:min-w-[80px] items-center gap-1 cursor-pointer hover:text-info transition-colors duration-200 ease-in-out"
        onClick={handleCommentClick}
      >
        <Icon name="reply" size={16} />
        {formatAmount(replyCount)}
      </button>

      {isPopupOpen && (
        <Modal onClose={handlePopupClose} hasBackground={false}>
          <div
            className="max-w-prose rounded-2xl bg-base-100"
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
