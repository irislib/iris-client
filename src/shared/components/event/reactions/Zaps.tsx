import {getZapAmount, getZappingUser} from "@/utils/nostr.ts"
import {UserRow} from "@/shared/components/user/UserRow.tsx"
import {ReactionContent} from "./ReactionContent"
import {NostrEvent} from "nostr-tools"
import {useEffect, useState} from "react"
import {subscribe} from "@/utils/applesauce"

export default function Zaps({event}: {event: NostrEvent}) {
  const [zapAmountByUser, setZapAmountByUser] = useState(new Map<string, number>())
  const [commentByUser, setCommentByUser] = useState(new Map<string, string>())

  useEffect(() => {
    try {
      setZapAmountByUser(new Map())
      setCommentByUser(new Map())
      const filter = {
        kinds: [9735],
        ["#e"]: [event.id],
      }
      const sub = subscribe(filter)

      sub?.on("event", async (event: NostrEvent) => {
        // if (shouldHideEvent(event)) return // enables fake zap receipts but what can we do.
        const user = getZappingUser(event)
        const amount = await getZapAmount(event)
        setZapAmountByUser((prev) => {
          prev.set(user, (prev.get(user) || 0) + amount)
          return new Map(prev)
        })
        setCommentByUser((prev) => {
          const comment = event.content
          prev.set(user, comment)
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
      {zapAmountByUser.size === 0 && <p>No zaps yet</p>}
      {Array.from(zapAmountByUser.entries())
        .sort(([, a], [, b]) => b - a)
        .map(([pubKey, amount]) => {
          const comment = commentByUser.get(pubKey) || ""
          return (
            <UserRow
              showHoverCard={true}
              key={event.id}
              pubKey={pubKey}
              description={
                <>
                  <ReactionContent content={comment} event={event} /> {String(amount)}
                </>
              }
            />
          )
        })}
    </div>
  )
}
