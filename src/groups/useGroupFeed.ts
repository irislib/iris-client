import {useEffect, useMemo, useState} from "react"
import {AppEvent, type EventFilter} from "@/lib/nostr"
import {nostr} from "@/utils/nostrClient"
import {getEventReplyReference} from "@/utils/threadReferences"
import {getEventGroup} from "./activity"
import {groupAddress} from "./model"
import {selectGroupFeedAuthors, type GroupFeedScope} from "./groupFeed"
import {type GroupAccess} from "./useGroup"
import {useGroupEvents} from "./useGroupEvents"

/** How long the member list must hold still before a still-loading group shows posts. */
const MEMBERS_QUIET_MS = 300

/**
 * Posts can load once members are known and have stopped changing, without waiting
 * for every relay to finish its membership history: a silent relay must not hide a
 * group's posts, and a still-growing list must not restart the feed on every arrival.
 */
function useMembersSettled(membersKey: string, historyComplete: boolean) {
  const [settled, setSettled] = useState(false)
  useEffect(() => {
    if (historyComplete || settled || !membersKey) return
    const timer = setTimeout(() => setSettled(true), MEMBERS_QUIET_MS)
    return () => clearTimeout(timer)
  }, [membersKey, historyComplete, settled])
  return historyComplete || settled
}

/** Each author gets a separate history allowance; extra identities need explicit opt-in. */
export function useGroupFeed(
  access: GroupAccess,
  viewer: string,
  scope: GroupFeedScope,
  pollsOnly: boolean,
  published: AppEvent[]
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
  const ready = useMembersSettled(selectedAuthors.join(), !access.loading)
  const filter: EventFilter = {
    kinds: pollsOnly ? [1068] : [1, 1068],
    "#h": [access.ref.id],
    "#a": [address],
  }
  const result = useGroupEvents(
    !ready
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
      ...result.events.map((event) => new AppEvent(nostr(), event)),
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
    ready,
    loading: !ready || result.loading,
    error: result.error,
    limited: result.limited || authors.length > 512,
    canLoadOlder: historyLimit < 200 && result.events.length >= historyLimit,
    loadOlder: () => setHistoryLimit((limit) => Math.min(200, limit + 40)),
    refresh: () => setRefreshKey((value) => value + 1),
  }
}
