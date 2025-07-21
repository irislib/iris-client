import {NDKEvent} from "@nostr-dev-kit/ndk"

import FeedItemComment from "./FeedItemComment.tsx"
import FeedItemRepost from "./FeedItemRepost.tsx"
import FeedItemShare from "./FeedItemShare.tsx"
import {FeedItemLike} from "./FeedItemLike.tsx"
import FeedItemZap from "./FeedItemZap.tsx"
import {RefObject} from "react"
import {useSettingsStore} from "@/stores/settings"

type FeedItemActionsProps = {
  event: NDKEvent
  feedItemRef: RefObject<HTMLDivElement | null>
}

function FeedItemActions({event, feedItemRef}: FeedItemActionsProps) {
  const {content} = useSettingsStore()

  if (!content.showReactionsBar) {
    return null
  }

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      className={
        "py-2 flex flex-row gap-4 z-20 items-center max-w-full select-none text-base-content/50"
      }
    >
      {event.kind !== 30078 && content.showReplies && <FeedItemComment event={event} />}
      {event.kind !== 30078 && content.showReposts && <FeedItemRepost event={event} />}
      {content.showLikes && <FeedItemLike event={event} />}
      {content.showZaps && <FeedItemZap feedItemRef={feedItemRef} event={event} />}
      <FeedItemShare event={event} />
    </div>
  )
}

export default FeedItemActions
