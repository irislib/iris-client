import {AppEvent} from "@/lib/nostr"
import {nip19} from "nostr-tools"
import {Link} from "@/navigation"
import {Avatar} from "@/shared/components/user/Avatar"

interface ReplyPreviewProps {
  replyingTo: AppEvent
}

export function ReplyPreview({replyingTo}: ReplyPreviewProps) {
  return (
    <div className="opacity-75 px-4">
      <Link to={`/${nip19.neventEncode({id: replyingTo.id})}`}>
        <div className="flex items-center gap-2">
          <Avatar pubKey={replyingTo.pubkey} width={32} showBadge={false} />
          <span className="text-sm">Replying to</span>
        </div>
      </Link>
      <div className="ml-12 mt-1 text-sm opacity-90 line-clamp-3">
        {replyingTo.content}
      </div>
    </div>
  )
}
