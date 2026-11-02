import {parseZapReceipt, groupZapsByUser, type ZapInfo} from "@/utils/nostr.ts"
import {UserRow} from "@/shared/components/user/UserRow.tsx"
import {ReactionContent} from "./ReactionContent"
import {AppEvent} from "@/lib/nostr"
import {useEffect, useMemo, useState} from "react"
import {nostr} from "@/utils/nostrClient"
import {KIND_ZAP_RECEIPT} from "@/utils/constants"
import {useGroupAccess} from "@/groups/GroupContext"
import {useGroupZaps} from "@/groups/useGroupZaps"
import {isVisibleGroupZap} from "@/groups/activity"
import {formatAmount} from "@/utils/utils"

export default function Zaps({event}: {event: AppEvent}) {
  const group = useGroupAccess()
  const memberZaps = useGroupZaps(event.id)
  const [zapsByUser, setZapsByUser] = useState(
    new Map<string, {totalAmount: number; zaps: ZapInfo[]}>()
  )

  useEffect(() => {
    try {
      // Clear previous state when event changes
      setZapsByUser(new Map())
      if (group) return

      const filter = {
        kinds: [KIND_ZAP_RECEIPT],
        ["#e"]: [event.id],
      }
      const sub = nostr().subscribe(filter)
      const allZaps: ZapInfo[] = []

      sub?.on("event", async (zapEvent: AppEvent) => {
        const zapInfo = parseZapReceipt(zapEvent)
        if (zapInfo) {
          // Check for duplicates
          if (!allZaps.some((z) => z.id === zapInfo.id)) {
            allZaps.push(zapInfo)
            const grouped = groupZapsByUser(allZaps)
            setZapsByUser(grouped)
          }
        }
      })
      return () => {
        sub.stop()
      }
    } catch (error) {
      console.warn(error)
    }
  }, [event.id, group?.ref.id, group?.ref.creator])

  const visibleZaps = useMemo(
    () =>
      groupZapsByUser(
        (group
          ? memberZaps
          : [...zapsByUser.values()].flatMap((user) => user.zaps)
        ).filter((zap) => isVisibleGroupZap(zap, event.id, group))
      ),
    [zapsByUser, memberZaps, event.id, group]
  )

  return (
    <div className="flex flex-col gap-4">
      {visibleZaps.size === 0 && <p>No zaps yet</p>}
      {Array.from(visibleZaps.entries())
        .sort(([, a], [, b]) => b.totalAmount - a.totalAmount)
        .map(([pubKey, data]) => {
          // Get the latest comment from the user's zaps
          const latestComment = data.zaps[data.zaps.length - 1]?.comment || ""
          return (
            <div key={pubKey} className="min-w-0 space-y-1">
              <UserRow
                showHoverCard={true}
                pubKey={pubKey}
                avatarWidth={40}
                textClassName="font-medium"
                description={
                  <span className="whitespace-nowrap text-sm font-medium">
                    {formatAmount(data.totalAmount)} sats
                  </span>
                }
              />
              {latestComment && (
                <p className="pl-12 text-sm text-base-content/80 [overflow-wrap:anywhere]">
                  <ReactionContent content={latestComment} event={event} />
                </p>
              )}
            </div>
          )
        })}
    </div>
  )
}
