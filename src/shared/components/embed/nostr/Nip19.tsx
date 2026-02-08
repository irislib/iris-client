import {nip19} from "nostr-tools"
import {useState, useEffect, type ReactNode} from "react"

import {Name} from "@/shared/components/user/Name.tsx"
import {ProfileLink} from "@/shared/components/user/ProfileLink"

import FeedItem from "@/shared/components/event/FeedItem/FeedItem.tsx"

import {NDKEvent} from "@/lib/ndk"
import type {Rumor} from "nostr-double-ratchet"
import {ndk} from "@/utils/ndk"

type EmbedEvent = NDKEvent | Rumor

type Embed = {
  regex: RegExp
  component: (props: {
    match: string
    index?: number
    event?: EmbedEvent
    key: string
    truncated?: boolean
  }) => ReactNode
  settingsKey?: string
  inline?: boolean
}

function Naddr({naddr, data}: {naddr: string; data: nip19.AddressPointer}) {
  const [event, setEvent] = useState<NDKEvent | null>(null)
  useEffect(() => {
    ndk()
      .fetchEvent(
        {
          authors: [data.pubkey],
          kinds: [data.kind],
          "#d": [data.identifier],
        },
        undefined
      )
      .then((e) => e && e.id && setEvent(e))
  }, [data.pubkey, data.kind, data.identifier])

  if (!event) {
    return (
      <div className="flex relative flex-col pt-3 px-4 min-h-[186px] pb-0 transition-colors duration-200 ease-in-out border-custom cursor-pointer border-2 pt-3 pb-3 my-2 rounded hover:bg-[var(--note-hover-color)] break-all">
        Loading naddr:{naddr}
      </div>
    )
  }

  return (
    <div className="px-4">
      <FeedItem event={event} key={event.id} asEmbed={true} />
    </div>
  )
}

const NostrUser: Embed = {
  regex: /\b(?:nostr:)?(n(?:event|profile|addr)1[a-zA-Z0-9]{10,})\b/g,
  component: ({match}) => {
    try {
      const {type, data} = nip19.decode(match)
      if (type === "nprofile") {
        return (
          <ProfileLink pubKey={data.pubkey} className="link link-info">
            <Name pubKey={data.pubkey} />
          </ProfileLink>
        )
      } else if (type === "nevent") {
        // same as note
        const authorHints = data.author ? [data.author] : undefined
        return (
          <div className="px-4">
            <FeedItem
              eventId={data.id}
              authorHints={authorHints}
              showActions={false}
              showRepliedTo={false}
              asEmbed={true}
            />
          </div>
        )
      } else if (type === "naddr") {
        return <Naddr key={match} data={data} naddr={match} />
      }
    } catch (error) {
      console.warn(error)
    }
    return <span>{match}</span>
  },
  inline: true,
}

export default NostrUser
