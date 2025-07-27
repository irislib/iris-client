import CopyButton from "@/shared/components/button/CopyButton.tsx"
import {NostrEvent} from "nostr-tools"

type RawJSONProps = {
  event: NostrEvent
}

function RawJSON({event}: RawJSONProps) {
  const rawEvent = {
    created_at: event.created_at,
    content: event.content,
    tags: event.tags,
    kind: event.kind,
    pubkey: event.pubkey,
    id: event.id,
    sig: event.sig,
  }

  return (
    <div className="flex flex-col justify-center select-text whitespace-pre-wrap break-words ">
      <div className="text-sm">{JSON.stringify(rawEvent, null, 4)}</div>
      <CopyButton className="btn" copyStr={JSON.stringify(rawEvent)} text="Copy" />
    </div>
  )
}

export default RawJSON
