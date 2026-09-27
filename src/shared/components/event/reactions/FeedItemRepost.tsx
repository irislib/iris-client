import {NDKEvent} from "@/lib/ndk"
import {useEffect, useMemo, useState} from "react"
import {ndk} from "@/utils/ndk"

import NoteCreator from "@/shared/components/create/NoteCreator.tsx"
import Dropdown from "@/shared/components/ui/Dropdown"
import Modal from "@/shared/components/ui/Modal.tsx"
import {LRUCache} from "typescript-lru-cache"
import {formatAmount} from "@/utils/utils.ts"
import Icon from "../../Icons/Icon"

import {shouldHideUser} from "@/utils/visibility"
import {useUserStore} from "@/stores/user"
import {KIND_REPOST} from "@/utils/constants"
import {useGroupAccess} from "@/groups/GroupContext"
import {
  inheritGroupTags,
  isAuthenticGroupActivity,
  isVisibleGroupActivity,
} from "@/groups/activity"
import {publishGroupEvent} from "@/groups/publish"
import {useToastStore} from "@/stores/toast"

interface FeedItemRepostProps {
  event: NDKEvent
  showReactionCounts?: boolean
}

const repostCache = new LRUCache<string, Map<string, NDKEvent>>({
  maxSize: 100,
})

function FeedItemRepost({event, showReactionCounts = true}: FeedItemRepostProps) {
  const group = useGroupAccess()
  const canParticipate = !group || group.canParticipate
  const myPubKey = useUserStore((state) => state.publicKey)

  const [reposts, setReposts] = useState<Map<string, NDKEvent>>(
    () => repostCache.get(event.id) || new Map()
  )
  const repostsByAuthor = useMemo(
    () =>
      new Map([...reposts].filter(([, repost]) => isVisibleGroupActivity(repost, group))),
    [reposts, group]
  )
  const repostCount = repostsByAuthor.size
  const [showButtons, setShowButtons] = useState(false)
  const [showQuoteModal, setShowQuoteModal] = useState(false)
  const reposted = repostsByAuthor.has(myPubKey)

  const handleRepost = async () => {
    if (!myPubKey || !canParticipate || reposted) return
    setShowButtons(false)
    try {
      const repost = group ? await event.repost(false) : await event.repost()
      if (group) {
        repost.tags = inheritGroupTags(event, repost.tags)
        await publishGroupEvent(repost)
      }
      setReposts((previous) => {
        const next = new Map(previous)
        next.set(myPubKey, repost)
        repostCache.set(event.id, next)
        return next
      })
    } catch (error) {
      console.warn("Unable to repost", error)
      useToastStore
        .getState()
        .addToast("Could not publish repost. Please try again.", "error")
    }
  }

  const handleQuote = () => {
    if (!canParticipate) return
    setShowButtons(false)
    setShowQuoteModal(true)
  }

  useEffect(() => {
    if (!canParticipate) {
      setShowButtons(false)
      setShowQuoteModal(false)
    }
  }, [canParticipate])

  useEffect(() => {
    setReposts(repostCache.get(event.id) || new Map())
    if (!showReactionCounts) return

    const filter = {
      kinds: [KIND_REPOST, 16],
      ["#e"]: [event.id],
    }

    try {
      // Group activity stays live; ordinary feeds close at EOSE to bound subscriptions.
      const sub = ndk().subscribe(filter, {closeOnEose: !group})

      sub?.on("event", (repostEvent: NDKEvent) => {
        if (shouldHideUser(repostEvent.pubkey)) return
        if (group && !isAuthenticGroupActivity(repostEvent, group.ref)) return
        setReposts((previous) => {
          const next = new Map(previous)
          next.set(repostEvent.pubkey, repostEvent)
          repostCache.set(event.id, next)
          return next
        })
      })

      return () => {
        sub.stop()
      }
    } catch (error) {
      console.warn(error)
    }
  }, [event.id, showReactionCounts, group?.ref.id, group?.ref.creator])

  return (
    <>
      {showQuoteModal && canParticipate && (
        <Modal onClose={() => setShowQuoteModal(false)} hasBackground={false}>
          <div
            className="w-[600px] max-w-[90vw] rounded-2xl bg-base-100"
            onClick={(e) => e.stopPropagation()}
          >
            <NoteCreator
              handleClose={() => setShowQuoteModal(false)}
              quotedEvent={event}
            />
          </div>
        </Modal>
      )}
      <button
        title={canParticipate ? "Repost" : "Members only"}
        aria-label="Repost"
        disabled={!canParticipate}
        className={`disabled:opacity-40 disabled:cursor-not-allowed ${
          reposted ? "cursor-pointer text-success" : "cursor-pointer hover:text-success"
        } m-1 transition-colors duration-200 ease-in-out dropdown dropdown-open flex flex-row gap-1 items-center min-w-[50px] md:min-w-[80px]`}
        onClick={() => myPubKey && canParticipate && setShowButtons(!showButtons)}
      >
        <Icon name="repost" size={16} />
        <div>
          {showButtons && canParticipate && (
            <Dropdown onClose={() => setShowButtons(false)}>
              <ul className="p-2 gap-2 shadow menu dropdown-content z-[1] bg-base-100 rounded-box w-32">
                <li>
                  <button className="btn btn-primary btn-sm" onClick={handleRepost}>
                    Repost
                  </button>
                </li>
                <li>
                  <button className="btn btn-primary btn-sm" onClick={handleQuote}>
                    Quote
                  </button>
                </li>
              </ul>
            </Dropdown>
          )}
        </div>
        <span>{showReactionCounts ? formatAmount(repostCount) : ""}</span>
      </button>
    </>
  )
}

export default FeedItemRepost
