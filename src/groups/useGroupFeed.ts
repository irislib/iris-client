import {useMemo, useState} from "react"
import {NDKEvent, type NDKFilter} from "@/lib/ndk"
import {ndk} from "@/utils/ndk"
import {getEventReplyReference} from "@/utils/threadReferences"
import {getEventGroup} from "./activity"
import {groupAddress} from "./model"
import {selectGroupFeedAuthors, type GroupFeedScope} from "./groupFeed"
import {type GroupAccess} from "./useGroup"
import {useGroupEvents} from "./useGroupEvents"

/** Each author gets a separate history allowance; extra identities need explicit opt-in. */
export function useGroupFeed(
  access: GroupAccess,
  viewer: string,
  scope: GroupFeedScope,
  pollsOnly: boolean,
  published: NDKEvent[]
) {
  const [historyLimit, setHistoryLimit] = useState(40)
  const [refreshKey, setRefreshKey] = useState(0)
  const address = groupAddress(access.ref)
  const authors = useMemo(
    () =>
      selectGroupFeedAuthors(
        access.membership?.authorityPubkeys ?? [],
        access.membership?.eligiblePubkeys ?? new Set(),
        viewer,
        scope
      ),
    [access.membership, viewer, scope]
  )
  const selectedAuthors = authors.slice(0, 512)
  const filter: NDKFilter = {
    kinds: pollsOnly ? [1068] : [1, 1068],
    "#h": [access.ref.id],
    "#a": [address],
  }
  const result = useGroupEvents(
    access.loading
      ? []
      : selectedAuthors.map((author) => ({
          ...filter,
          authors: [author],
          limit: historyLimit,
        })),
    Math.max(1, selectedAuthors.length * historyLimit),
    {
      perAuthorCap: historyLimit,
      liveFilters: selectedAuthors.length ? [{...filter, authors: selectedAuthors}] : [],
      refreshKey,
    }
  )
  const events = useMemo(() => {
    const allowed = new Set(selectedAuthors)
    const candidates = [
      ...published,
      ...result.events.map((event) => new NDKEvent(ndk(), event)),
    ]
    const seen = new Set<string>()
    return candidates.filter((event) => {
      const ref = getEventGroup(event)
      if (
        seen.has(event.id) ||
        !allowed.has(event.pubkey) ||
        !ref ||
        groupAddress(ref) !== address ||
        (pollsOnly && event.kind !== 1068) ||
        (!pollsOnly && event.kind !== 1 && event.kind !== 1068) ||
        getEventReplyReference(event)
      )
        return false
      seen.add(event.id)
      return true
    })
  }, [published, result.events, authors.join(), address, pollsOnly])
  return {
    events,
    loading: access.loading || result.loading,
    error: result.error,
    limited: result.limited || authors.length > 512,
    canLoadOlder: historyLimit < 200 && result.events.length >= historyLimit,
    loadOlder: () => setHistoryLimit((limit) => Math.min(200, limit + 40)),
    refresh: () => setRefreshKey((value) => value + 1),
  }
}
