import FeedItem from "@/shared/components/event/FeedItem/FeedItem.tsx"
import type Embed from "../index.ts"
import {nip19} from "nostr-tools"

import {eventRegex} from "./noteRegex.ts"

const NostrNote: Embed = {
  regex: eventRegex,
  component: ({match, event}) => {
    try {
      const hex = nip19.decode(match.replace("@", ""))
      if (!hex) throw new Error(`Invalid hex: ${match}`)
      return (
        <div className="px-4">
          <FeedItem
            eventId={hex.data as string}
            relayHints={event?.tags
              .filter((tag) => ["e", "q"].includes(tag[0]) && tag[1] === hex.data)
              .map((tag) => tag[2])
              .filter(Boolean)}
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
