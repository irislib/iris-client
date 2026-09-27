import {useMemo} from "react"
import {NDKEvent, type NDKFilter} from "@/lib/ndk"
import {useGroupAccess} from "./GroupContext"
import {groupAddress} from "./model"
import {isVisibleGroupActivity} from "./activity"
import {useGroupEvents} from "./useGroupEvents"

/** Only eligible authors occupy history slots; one prolific author has its own cap. */
export function useGroupActivity(
  filters: NDKFilter[],
  perAuthorCap = 32,
  enabled = true
) {
  const group = useGroupAccess()
  const authors = group ? [...(group.membership?.eligiblePubkeys ?? [])].sort() : []
  const retainedPerAuthor = Math.max(
    1,
    Math.min(perAuthorCap, Math.floor(8192 / Math.max(1, authors.length)))
  )
  const scoped =
    group && enabled && authors.length
      ? filters.map((filter) => ({
          ...filter,
          "#h": [group.ref.id],
          // Addressable replies already use #a for their parent address.
          ...(!filter["#a"] ? {"#a": [groupAddress(group.ref)]} : {}),
        }))
      : []
  const events = useGroupEvents(
    scoped.flatMap((filter) =>
      authors.map((author) => ({
        ...filter,
        authors: [author],
        limit: retainedPerAuthor,
      }))
    ),
    Math.max(1, Math.min(8192, authors.length * retainedPerAuthor)),
    {
      liveFilters: scoped.map((filter) => ({...filter, authors})),
      perAuthorCap: retainedPerAuthor,
    }
  )
  return useMemo(
    () =>
      events.events
        .map((event) => new NDKEvent(undefined, event))
        .filter((event) => isVisibleGroupActivity(event, group)),
    [events.events, group]
  )
}
