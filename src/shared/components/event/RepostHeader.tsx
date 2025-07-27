import {Name} from "@/shared/components/user/Name"
import {RiRepeatFill} from "@remixicon/react"
import {NostrEvent, nip19} from "nostr-tools"
import {Link} from "react-router"

interface RepostHeaderProps {
  event: NostrEvent
}

function RepostHeader({event}: RepostHeaderProps) {
  return (
    <Link
      to={`/${nip19.npubEncode(event.pubkey)}`}
      className="flex items-center font-bold text-sm text-base-content/50 hover:underline"
    >
      <Name pubKey={event.pubkey} />
      <span className="mx-1">reposted</span>
      <RiRepeatFill className="w-4 h-4" />
    </Link>
  )
}

export default RepostHeader
