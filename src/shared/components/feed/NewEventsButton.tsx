import {AvatarGroup} from "@/shared/components/user/AvatarGroup.tsx"
import {NDKEvent} from "@nostr-dev-kit/ndk"
import {RefObject} from "react"

interface NewEventsButtonProps {
  newEventsFiltered: NDKEvent[]
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
        className="btn btn-info shadow-xl rounded-full flex items-center gap-2"
        onClick={() => {
          showNewEvents()
          firstFeedItemRef?.current?.scrollIntoView({block: "start"})
          window.scrollBy(0, -200) // scroll a bit above
        }}
      >
        <AvatarGroup pubKeys={Array.from(newEventsFrom).slice(0, 3)} />
        Show {newEventsFiltered.length > 99 ? "99+" : newEventsFiltered.length} new events
      </button>
    </div>
  )
}

export default NewEventsButton
