import MarketListing from "../../market/MarketListing"
import ChannelCreation from "../ChannelCreation.tsx"
import {NostrEvent} from "nostr-tools"
import {getTagValue} from "@/utils/nostr"
import ZapReceipt from "../ZapReceipt.tsx"
import Zapraiser from "../Zapraiser.tsx"
import Highlight from "../Highlight.tsx"
import TextNote from "../TextNote.tsx"
import LongForm from "../LongForm.tsx"
import {memo} from "react"

type ContentProps = {
  event: NostrEvent | undefined
  referredEvent: NostrEvent | undefined
  standalone?: boolean
  truncate: number
}

const FeedItemContent = ({event, referredEvent, standalone, truncate}: ContentProps) => {
  if (!event) {
    return ""
  } else if (referredEvent) {
    return <TextNote event={referredEvent} truncate={truncate} />
  } else if (event.kind === 9735) {
    return <ZapReceipt event={event} />
  } else if (event.kind === 1 && getTagValue(event, "zapraiser")) {
    return <Zapraiser event={event} />
  } else if (event.kind === 9802) {
    return <Highlight event={event} />
  } else if (event.kind === 30023) {
    return <LongForm event={event} standalone={standalone} />
  } else if (event.kind === 30402) {
    return (
      <MarketListing
        key={`${event.id}-${truncate > 0}`}
        event={event}
        truncate={truncate}
      />
    )
  } else if (event.kind === 40) {
    return <ChannelCreation event={event} />
  } else {
    return <TextNote event={event} truncate={truncate} />
  }
}

export default memo(FeedItemContent)
