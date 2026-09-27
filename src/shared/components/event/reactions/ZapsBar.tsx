import {NDKEvent} from "@/lib/ndk"
import {useEffect, useMemo, useState} from "react"
import {formatAmount} from "@/utils/utils"
import {parseZapReceipt, type ZapInfo} from "@/utils/nostr"
import {Name} from "@/shared/components/user/Name"
import {ndk} from "@/utils/ndk"
import {Link} from "@/navigation"
import {nip19} from "nostr-tools"
import {KIND_ZAP_RECEIPT} from "@/utils/constants"
import {shouldHideUser} from "@/utils/visibility"
import {useGroupAccess} from "@/groups/GroupContext"
import {useGroupZaps} from "@/groups/useGroupZaps"
import {isVisibleGroupZap} from "@/groups/activity"

interface ZapsBarProps {
  event: NDKEvent
}

export default function ZapsBar({event}: ZapsBarProps) {
  const group = useGroupAccess()
  const memberZaps = useGroupZaps(event.id)
  const [zaps, setZaps] = useState<ZapInfo[]>([])

  const visibleZaps = useMemo(
    () =>
      (group ? memberZaps : zaps).filter(
        (zap) => !shouldHideUser(zap.pubkey) && isVisibleGroupZap(zap, event.id, group)
      ),
    [zaps, memberZaps, event.id, group]
  )

  useEffect(() => {
    setZaps([])
    if (group) return
    const filter = {
      kinds: [KIND_ZAP_RECEIPT],
      ["#e"]: [event.id],
    }

    const sub = ndk().subscribe(filter)
    const processedEvents = new Set<string>()

    sub?.on("event", (zapEvent: NDKEvent) => {
      // Skip if already processed
      if (processedEvents.has(zapEvent.id)) {
        return
      }
      processedEvents.add(zapEvent.id)

      const zapInfo = parseZapReceipt(zapEvent)
      if (zapInfo && !shouldHideUser(zapInfo.pubkey)) {
        setZaps((prev) => {
          const exists = prev.some((z) => z.id === zapEvent.id)
          if (exists) return prev

          const newZaps = [...prev, {...zapInfo, comment: zapInfo.comment.slice(0, 50)}]
          // Sort by amount descending
          return newZaps.sort((a, b) => b.amount - a.amount)
        })
      }
    })

    return () => {
      sub.stop()
    }
  }, [event.id, group?.ref.id, group?.ref.creator])

  return (
    <div className="flex gap-2 overflow-x-auto py-2 scrollbar-thin min-h-[38px]">
      {visibleZaps.length === 0 ? (
        // Invisible placeholder with same height as actual elements
        <div className="flex-shrink-0 px-3 py-1.5 opacity-0">
          <span className="text-sm">⚡ 0</span>
        </div>
      ) : (
        visibleZaps.map((zap) => (
          <Link
            key={zap.id}
            to={`/${nip19.npubEncode(zap.pubkey)}`}
            onClick={(e) => e.stopPropagation()}
            className="flex-shrink-0 flex items-center gap-2 px-3 py-1.5 rounded-full bg-orange-500/10 border border-orange-500/20 text-sm hover:bg-orange-500/20 transition-colors cursor-pointer"
          >
            <span className="text-orange-500 font-semibold">
              ⚡ {formatAmount(zap.amount)}
            </span>
            <span className="truncate max-w-[120px]">
              <Name pubKey={zap.pubkey} />
            </span>
            {zap.comment && (
              <span className="text-base-content/50 text-xs max-w-[150px] truncate">
                &ldquo;{zap.comment}&rdquo;
              </span>
            )}
          </Link>
        ))
      )}
    </div>
  )
}
