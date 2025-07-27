import {AvatarGroup} from "@/shared/components/user/AvatarGroup.tsx"
import {NostrEvent} from "nostr-tools"
import {RefObject} from "react"

interface NewEventsButtonProps {
  newEventsFiltered: NostrEvent[]
  newEventsFrom: Set<string>
  showNewEvents: () => void
  firstFeedItemRef: RefObject<HTMLDivElement | null>
}

const NewEventsButton = ({
  newEventsFiltered,
  newEventsFrom,
  showNewEvents,
  firstFeedItemRef,
}: NewEventsButtonProps) => {
  if (newEventsFiltered.length === 0) return null

  return (
    <div className="fixed bottom-20 md:bottom-10 left-1/2 transform -translate-x-1/2 z-30 flex justify-center w-full max-w-lg pb-[env(safe-area-inset-bottom)]">
      <button
        className="btn btn-info shadow-xl rounded-full"
        onClick={() => {
          showNewEvents()

          // Scroll to first feed item with offset, then ensure header is visible
          if (firstFeedItemRef?.current) {
            const rect = firstFeedItemRef.current.getBoundingClientRect()
            const scrollTop = window.scrollY + rect.top - 200 // 200px offset above
            window.scrollTo({top: Math.max(0, scrollTop), behavior: "instant"})
          } else {
            // Fallback to top if ref not available
            window.scrollTo({top: 0, behavior: "instant"})
          }
        }}
      >
        <AvatarGroup pubKeys={Array.from(newEventsFrom).slice(0, 3)} />
        Show {newEventsFiltered.length > 99 ? "99+" : newEventsFiltered.length} new events
      </button>
    </div>
  )
}

export default NewEventsButton
