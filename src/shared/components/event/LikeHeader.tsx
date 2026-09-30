import {CustomEmojiComponent} from "../embed/nostr/CustomEmojiComponent"
import {Name} from "@/shared/components/user/Name"
import {AppEvent} from "@/lib/nostr"
import {Link} from "@/navigation"
import {nip19} from "nostr-tools"

interface LikeHeaderProps {
  event: AppEvent
}

function LikeHeader({event}: LikeHeaderProps) {
  const reactionText =
    event.content === "+" ? (
      <span className="text-base-content/50">liked</span>
    ) : (
      <>
        <span className="text-base-content/50">reacted with </span>
        {event.content.startsWith(":") && event.content.endsWith(":") ? (
          <CustomEmojiComponent match={event.content.slice(1, -1)} event={event} />
        ) : (
          <span>{event.content}</span>
        )}
      </>
    )

  return (
    <Link
      to={`/${nip19.npubEncode(event.pubkey)}`}
      className="flex items-center font-bold text-sm hover:underline"
    >
      <Name pubKey={event.pubkey} className="text-base-content/50" />
      <span className="mx-1">{reactionText}</span>
    </Link>
  )
}

export default LikeHeader
