import {Link} from "react-router"
import {nip19, NostrEvent} from "nostr-tools"

import {Name} from "@/shared/components/user/Name.tsx"

import FeedItem from "@/shared/components/event/FeedItem/FeedItem.tsx"
import Embed from "../index.ts"

import {useState, useEffect} from "react"
import {getPool, DEFAULT_RELAYS} from "@/utils/applesauce"

function Naddr({naddr, data}: {naddr: string; data: nip19.AddressPointer}) {
  const [event, setEvent] = useState<NostrEvent | null>(null)
  useEffect(() => {
    const pool = getPool()
    const subscription = pool.subscription(DEFAULT_RELAYS, {
      authors: [data.pubkey],
      kinds: [data.kind],
      "#d": [data.identifier],
    })

    const sub = subscription.subscribe({
      next: (e) => {
        if (typeof e !== "string" && e && e.id) {
          setEvent(e)
        }
      },
      error: (error) => {
        console.error("Subscription error:", error)
      },
    })

    return () => sub.unsubscribe()
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
          <Link className="link link-info" to={`/${nip19.npubEncode(data.pubkey)}`}>
            <Name pubKey={data.pubkey} />
          </Link>
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
