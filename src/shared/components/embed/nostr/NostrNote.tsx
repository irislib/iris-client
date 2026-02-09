import FeedItem from "@/shared/components/event/FeedItem/FeedItem.tsx"
import type Embed from "../index.ts"
import {nip19} from "nostr-tools"

import {eventRegex} from "./noteRegex.ts"

const NostrNote: Embed = {
  regex: eventRegex,
  component: ({match}) => {
    try {
      const hex = nip19.decode(match.replace("@", ""))
      if (!hex) throw new Error(`Invalid hex: ${match}`)
      return (
        <div className="px-4">
          <FeedItem
            eventId={hex.data as string}
            key={hex.data as string}
            showActions={false}
            showRepliedTo={false}
            asEmbed={true}
          />
        </div>
      )
    } catch (error) {
      return match
    }
  },
}

export default NostrNote
