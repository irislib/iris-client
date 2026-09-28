import {useMemo} from "react"
import {NDKEvent} from "@/lib/ndk"
import {parseZapReceipt} from "@/utils/nostr"
import {useGroupAccess} from "./GroupContext"
import {isVisibleGroupZap} from "./activity"
import {useGroupEvents} from "./useGroupEvents"

/** Receipt signers are payment services; #P indexes the signed request's member. */
export function useGroupZaps(targetId: string, enabled = true) {
  const group = useGroupAccess()
  const authors = group && enabled ? [...group.visiblePubkeys].sort() : []
  const retainedPerAuthor = Math.max(
    1,
    Math.min(32, Math.floor(8192 / Math.max(1, authors.length)))
  )
  const filter = {kinds: [9735], "#e": [targetId]}
  const source = useGroupEvents(
    authors.map((author) => ({...filter, "#P": [author], limit: retainedPerAuthor})),
    Math.max(1, Math.min(8192, authors.length * retainedPerAuthor)),
    {
      liveFilters: authors.length ? [{...filter, "#P": authors}] : [],
      perAuthorCap: retainedPerAuthor,
      ...(group ? {zap: {ref: group.ref, targetId, authors}} : {}),
    }
  )
  return useMemo(
    () =>
      source.events.flatMap((raw) => {
        const zap = parseZapReceipt(new NDKEvent(undefined, raw))
        return zap && isVisibleGroupZap(zap, targetId, group) ? [zap] : []
      }),
    [source.events, group, targetId]
  )
}
