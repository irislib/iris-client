import {RiReplyLine} from "@remixicon/react"
import {AppEvent} from "@/lib/nostr"
import {useState, useEffect} from "react"
import {nostr} from "@/utils/nostrClient"
import {Name} from "@/shared/components/user/Name"

interface ReplyHeaderProps {
  repliedToEventId?: string
}

function ReplyHeader({repliedToEventId}: ReplyHeaderProps) {
  const [repliedToEvent, setRepliedToEvent] = useState<AppEvent | null>(null)

  useEffect(() => {
    if (!repliedToEventId) return

    // Use NostrClient's built-in cache via fetchEvent
    nostr()
      .fetchEvent(repliedToEventId)
      .then((event) => {
        if (event) setRepliedToEvent(event)
      })
      .catch((err) => console.error("Error fetching replied event:", err))
  }, [repliedToEventId])

  return (
    <div className="flex items-center font-bold text-sm text-base-content/50">
      <RiReplyLine className="w-4 h-4 mr-1" />
      <span>
        {repliedToEvent ? (
          <>
            Replying to <Name pubKey={repliedToEvent.pubkey} />
          </>
        ) : (
          "Reply"
        )}
      </span>
    </div>
  )
}

export default ReplyHeader
