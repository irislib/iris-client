import {parseZapReceipt} from "@/utils/nostr.ts"
import {UserRow} from "@/shared/components/user/UserRow.tsx"
import {AppEvent} from "@/lib/nostr"
import {useEffect, useMemo, useState} from "react"
import {nostr} from "@/utils/nostrClient"
import {KIND_ZAP_RECEIPT} from "@/utils/constants"
import {useGroupAccess} from "@/groups/GroupContext"
import {useGroupZaps} from "@/groups/useGroupZaps"
import {formatAmount} from "@/utils/utils"
import {
  addPostZap,
  orderedZapSenders,
  readPostZap,
  type ZapSender,
} from "./postZapSenders"

export default function Zaps({event}: {event: AppEvent}) {
  const group = useGroupAccess()
  const memberZaps = useGroupZaps(event.id)
  const [publicSenders, setPublicSenders] = useState<ZapSender[]>([])
  const inGroup = Boolean(group)

  useEffect(() => {
    setPublicSenders([])
    if (inGroup) return
    const senders = new Map<string | null, ZapSender>()
    const seen = new Set<string>()
    let frame = 0
    const sub = nostr().subscribe({kinds: [KIND_ZAP_RECEIPT], "#e": [event.id]})
    sub.on("event", (raw: AppEvent) => {
      if (seen.has(raw.id)) return
      seen.add(raw.id)
      const receipt = parseZapReceipt(raw)
      const zap = receipt && readPostZap(receipt, event.id)
      if (!zap) return
      addPostZap(senders, zap)
      if (!frame)
        frame = requestAnimationFrame(() => {
          frame = 0
          setPublicSenders(orderedZapSenders(senders))
        })
    })
    return () => {
      sub.stop()
      cancelAnimationFrame(frame)
    }
  }, [event.id, inGroup])

  // Group membership changes can remove receipts. Rebuild from the visible snapshot,
  // retaining request verification only for receipts still in it.
  const groupCache = useMemo(
    () => new Map<string, ReturnType<typeof readPostZap>>(),
    [event.id]
  )
  const groupSenders = useMemo(() => {
    if (!inGroup) return []
    const senders = new Map<string | null, ZapSender>()
    const retained = new Set<string>()
    for (const receipt of memberZaps) {
      if (retained.has(receipt.id)) continue
      retained.add(receipt.id)
      if (!groupCache.has(receipt.id))
        groupCache.set(receipt.id, readPostZap(receipt, event.id))
      const zap = groupCache.get(receipt.id)
      if (zap) addPostZap(senders, zap)
    }
    for (const id of groupCache.keys()) if (!retained.has(id)) groupCache.delete(id)
    return orderedZapSenders(senders)
  }, [inGroup, memberZaps, event.id, groupCache])

  const senders = inGroup ? groupSenders : publicSenders
  if (!senders.length) return <p>No zaps yet</p>
  return (
    <ul aria-label="Zap senders" className="flex flex-col gap-4">
      {senders.map(({sender, totalMsats, largest}) => {
        const amount = (
          <span className="whitespace-nowrap text-sm font-medium">
            {formatAmount(Number(totalMsats / 1000n))} sats
          </span>
        )
        return (
          <li key={sender ?? "anonymous"} className="min-w-0 space-y-1">
            {sender ? (
              <UserRow
                showHoverCard
                pubKey={sender}
                avatarWidth={40}
                textClassName="font-medium"
                description={amount}
              />
            ) : (
              <div className="flex items-center justify-between gap-2 pl-12">
                <span className="font-medium">Anonymous</span>
                {amount}
              </div>
            )}
            {largest.message && (
              <p className="pl-12 text-sm text-base-content/80 [overflow-wrap:anywhere]">
                {largest.message}
              </p>
            )}
          </li>
        )
      })}
    </ul>
  )
}
