import {KIND_REACTION} from "@/utils/constants"
import type {Notification, NotificationEvent} from "./notifications"
import {SortedMap} from "./SortedMap/SortedMap"
import {getHexEventIdFromThreadReference} from "./threadReferences"

export interface ReactionPost {
  target: string
  events: NotificationEvent[]
}

export type NotificationRow =
  | {key: string; time: number; notification: Notification}
  | {key: string; time: number; actor: string; posts: ReactionPost[]}

const newestFirst = (a: NotificationEvent, b: NotificationEvent) =>
  b.time - a.time || a.event.id.localeCompare(b.event.id)

const bucketKey = ({user, time}: NotificationEvent) =>
  `actor:${user}:${Math.floor(time / 86400)}`

export function groupNotifications(
  entries: Iterable<[string, Notification]>
): NotificationRow[] {
  const rows: NotificationRow[] = []
  const reactions: [string, Notification][] = []
  const buckets = new Map<string, Map<string, NotificationEvent[]>>()
  const exclusive = new Set<string>()

  for (const [key, item] of entries) {
    const target = getHexEventIdFromThreadReference(item.originalEventId)
    if (item.kind !== KIND_REACTION || !target || !item.events?.length) {
      rows.push({key, time: item.time, notification: item})
      continue
    }
    reactions.push([key, item])
    const owners = new Set<string>()
    for (const event of item.events) {
      const bucket = bucketKey(event)
      owners.add(bucket)
      const posts = buckets.get(bucket) ?? new Map<string, NotificationEvent[]>()
      const events = posts.get(target) ?? []
      events.push(event)
      posts.set(target, events)
      buckets.set(bucket, posts)
    }
    if (owners.size === 1) exclusive.add(bucketKey(item.events[0]))
  }

  // Each actor row must replace at least one complete post row. A few popular
  // posts can otherwise turn into many more rows, one for every repeat visitor.
  const grouped = new Set<string>()
  for (const [key, targets] of buckets) {
    if (targets.size < 2 || !exclusive.has(key)) continue
    grouped.add(key)
    const posts = Array.from(targets, ([target, events]) => ({
      target,
      events: events.sort(newestFirst),
    })).sort((a, b) => newestFirst(a.events[0], b.events[0]))
    const latest = posts[0].events[0]
    rows.push({key, actor: latest.user, time: latest.time, posts})
  }

  for (const [key, item] of reactions) {
    const events = item.events.filter((event) => !grouped.has(bucketKey(event)))
    if (!events.length) continue
    if (events.length === item.events.length) {
      rows.push({key, notification: item, time: item.time})
      continue
    }
    events.sort(newestFirst)
    const latest = events[0]
    const users: Notification["users"] = new SortedMap([], "time")
    for (const {user, content, time, event} of events) {
      if (!users.has(user)) users.set(user, {content, time, eventId: event.id})
    }
    rows.push({
      key,
      time: latest.time,
      notification: {
        ...item,
        id: latest.event.id,
        time: latest.time,
        content: latest.event.content,
        tags: latest.event.tags,
        users,
        events,
      },
    })
  }
  return rows.sort((a, b) => b.time - a.time || a.key.localeCompare(b.key))
}
