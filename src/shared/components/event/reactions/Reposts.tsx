import {UserRow} from "@/shared/components/user/UserRow.tsx"
import {shouldHideAuthor} from "@/utils/visibility"
import socialGraph from "@/utils/socialGraph"
import {NostrEvent} from "nostr-tools"
import {useEffect, useState} from "react"
import {subscribe} from "@/utils/applesauce"

export default function Reposts({event}: {event: NostrEvent}) {
  const [reactions, setReactions] = useState<Map<string, NostrEvent>>(new Map())

  useEffect(() => {
    try {
      setReactions(new Map())
      const filter = {
        kinds: [6],
        ["#e"]: [event.id],
      }
      const sub = subscribe(filter)

      sub?.on("event", (event: NostrEvent) => {
        if (shouldHideAuthor(event.pubkey)) return
        setReactions((prev) => {
          const existing = prev.get(event.pubkey)
          if (existing) {
            if (existing.created_at! < event.created_at!) {
              prev.set(event.pubkey, event)
            }
          } else {
            prev.set(event.pubkey, event)
          }
          return new Map(prev)
        })
      })
      return () => {
        sub.stop()
      }
    } catch (error) {
      console.warn(error)
    }
  }, [event.id])

  return (
    <div className="flex flex-col gap-4">
      {reactions.size === 0 && <p>No reposts yet</p>}
      {Array.from(reactions.values())
        .sort((a, b) => {
          return (
            socialGraph().getFollowDistance(a.pubkey) -
            socialGraph().getFollowDistance(b.pubkey)
          )
        })
        .map((event) => (
          <UserRow showHoverCard={true} key={event.id} pubKey={event.pubkey} />
        ))}
    </div>
  )
}
