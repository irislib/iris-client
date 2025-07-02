import {NDKEvent} from "@nostr-dev-kit/ndk"
import {useEffect, useState} from "react"
import {useLocation} from "react-router"
import debounce from "lodash/debounce"
import {ndk} from "@/utils/ndk"

import NoteCreator from "@/shared/components/create/NoteCreator.tsx"
import Dropdown from "@/shared/components/ui/Dropdown"
import Modal from "@/shared/components/ui/Modal.tsx"
import {LRUCache} from "typescript-lru-cache"
import {formatAmount} from "@/utils/utils.ts"
import Icon from "../../Icons/Icon"

import {shouldHideAuthor} from "@/utils/visibility"
import {useUserStore} from "@/stores/user"

interface FeedItemRepostProps {
  event: NDKEvent
}

const repostCache = new LRUCache<string, Set<string>>({
  maxSize: 100,
})

function FeedItemRepost({event}: FeedItemRepostProps) {
  const location = useLocation()
  const myPubKey = useUserStore((state) => state.publicKey)

  const cachedReposts = repostCache.get(event.id)
  const [repostsByAuthor, setRepostsByAuthor] = useState<Set<string>>(
    cachedReposts || new Set()
  )
  const [repostCount, setRepostCount] = useState(repostsByAuthor.size)
  const [showButtons, setShowButtons] = useState(false)
  const [showQuoteModal, setShowQuoteModal] = useState(false)
  const reposted = repostsByAuthor.has(myPubKey)

  const handleRepost = async () => {
    if (reposted) return
    setShowButtons(false)
    try {
      event.repost()
      setRepostsByAuthor((prev) => {
        const newSet = new Set(prev)
        newSet.add(myPubKey)
        repostCache.set(event.id, newSet)
        setRepostCount(newSet.size)
        return newSet
      })
    } catch (error) {
      console.warn("Unable to repost", error)
    }
  }

  const handleQuote = () => {
    setShowButtons(false)
    setShowQuoteModal(true)
  }

  useEffect(() => {
    const filter = {
      kinds: [6],
      ["#e"]: [event.id],
    }

    try {
      const sub = ndk().subscribe(filter)

      const debouncedUpdate = debounce((repostsByAuthor) => {
        setRepostCount(repostsByAuthor.size)
      }, 300)

      sub?.on("event", (repostEvent: NDKEvent) => {
        if (shouldHideAuthor(repostEvent.author.pubkey)) return
        setRepostsByAuthor((prev) => {
          const newSet = new Set(prev)
          newSet.add(repostEvent.pubkey)
          repostCache.set(event.id, newSet)
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
  }, [location.pathname])

  return (
    <>
      {showQuoteModal && (
        <Modal onClose={() => setShowQuoteModal(false)}>
          <NoteCreator handleClose={() => setShowQuoteModal(false)} quotedEvent={event} />
        </Modal>
      )}
      <button
        title="Repost"
        className={`reaction-btn dropdown dropdown-open ${
          reposted ? "text-success" : "hover:text-success"
        }`}
        onClick={() => myPubKey && setShowButtons(!showButtons)}
      >
        <Icon name="repost" className="sidebar-nav-icon" />
        <div>
          {showButtons && (
            <Dropdown onClose={() => setShowButtons(false)}>
              <ul className="absolute top-full mt-1 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 z-10 p-2 space-y-1 w-32">
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
        <span className="reaction-count">{formatAmount(repostCount)}</span>
      </button>
    </>
  )
}

export default FeedItemRepost
