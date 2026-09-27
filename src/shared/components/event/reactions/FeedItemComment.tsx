import {NDKEvent, NDKFilter} from "@/lib/ndk"
import {shouldHideEvent} from "@/utils/visibility"
import {useEffect, useMemo, useState} from "react"
import {ndk} from "@/utils/ndk"

import Modal from "@/shared/components/ui/Modal.tsx"
import {formatAmount} from "@/utils/utils.ts"
import {useUserStore} from "@/stores/user"
import Icon from "../../Icons/Icon"

import NoteCreator from "@/shared/components/create/NoteCreator.tsx"
import {LRUCache} from "typescript-lru-cache"
import {useGroupAccess} from "@/groups/GroupContext"
import {isAuthenticGroupActivity, isVisibleGroupActivity} from "@/groups/activity"
import {
  buildReplySubscriptionFilters,
  getEventReplyReference,
  getEventRootReference,
} from "@/utils/threadReferences"

interface FeedItemCommentProps {
  event: NDKEvent
  showReactionCounts?: boolean
}

const repliesByEventCache = new LRUCache<string, Map<string, NDKEvent>>({maxSize: 100})

function FeedItemComment({event, showReactionCounts = true}: FeedItemCommentProps) {
  const group = useGroupAccess()
  const canParticipate = !group || group.canParticipate
  const myPubKey = useUserStore((state) => state.publicKey)
  const threadReference = event.tagId()
  const [replies, setReplies] = useState<Map<string, NDKEvent>>(
    () => repliesByEventCache.get(threadReference) || new Map()
  )
  const replyCount = useMemo(
    () =>
      [...replies.values()].filter((reply) => isVisibleGroupActivity(reply, group))
        .length,
    [replies, group]
  )

  const [isPopupOpen, setPopupOpen] = useState(false)

  const handleCommentClick = () => {
    myPubKey && canParticipate && setPopupOpen(!isPopupOpen)
  }

  const handlePopupClose = () => {
    setPopupOpen(false)
  }

  useEffect(() => {
    if (!canParticipate) setPopupOpen(false)
  }, [canParticipate])

  // refetch when location.pathname changes
  // to refetch count when switching display profile
  useEffect(() => {
    if (!showReactionCounts) return

    setReplies(repliesByEventCache.get(threadReference) || new Map())
    const filters: NDKFilter[] = buildReplySubscriptionFilters(event)

    try {
      // Group activity stays live; ordinary feeds close at EOSE to bound subscriptions.
      const subs = filters.map((filter) => ndk().subscribe(filter, {closeOnEose: !group}))

      subs.forEach((sub) =>
        sub?.on("event", (e: NDKEvent) => {
          if (shouldHideEvent(e)) return
          if (group && !isAuthenticGroupActivity(e, group.ref)) return
          if (
            getEventRootReference(e) !== threadReference &&
            getEventReplyReference(e) !== threadReference
          )
            return

          setReplies((previous) => {
            if (previous.has(e.id)) return previous
            const next = new Map(previous)
            next.set(e.id, e)
            repliesByEventCache.set(threadReference, next)
            return next
          })
        })
      )

      return () => {
        subs.forEach((sub) => sub.stop())
      }
    } catch (error) {
      console.warn(error)
    }
  }, [event, showReactionCounts, threadReference, group?.ref.id, group?.ref.creator])

  return (
    <>
      <button
        title={canParticipate ? "Reply" : "Members only"}
        aria-label="Reply"
        disabled={!canParticipate}
        className="disabled:opacity-40 disabled:cursor-not-allowed flex flex-row items-center min-w-[50px] md:min-w-[80px] items-center gap-1 cursor-pointer hover:text-info transition-colors duration-200 ease-in-out"
        onClick={handleCommentClick}
      >
        <Icon name="reply" size={16} />
        {showReactionCounts ? formatAmount(replyCount) : ""}
      </button>

      {isPopupOpen && canParticipate && (
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
