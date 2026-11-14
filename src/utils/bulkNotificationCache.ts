import {verifyEvent, type Event} from "nostr-tools"
import {liveQuery} from "dexie"
import localforage from "localforage"
import {getMainThreadDb} from "@/lib/nostr/db"
import {allowsBulkPost, immediateReplyTag, isBulkPost} from "./bulkNotifications"

export const PUSH_VIEWER_KEY = "notification-viewer"
export const pushFollowsKey = (viewer: string) => "notification-follows." + viewer

function signedParentAuthor(id: string, stored?: {event: string}): string | undefined {
  if (!stored) return
  try {
    const parent = JSON.parse(stored.event) as Event
    if (parent.id === id && verifyEvent(parent)) return parent.pubkey
  } catch {
    // A malformed local record cannot confirm a parent author.
  }
}

// Track only the parent IDs referenced by the bounded notification history.
// Dexie observes local writes, including a parent arriving later in another tab.
export function watchParentAuthors(
  ids: string[],
  changed: (authors: Map<string, string>) => void
) {
  const sub = liveQuery(async () => {
    const records = await getMainThreadDb().events.bulkGet(ids)
    const authors = new Map<string, string>()
    records.forEach((record, index) => {
      const author = signedParentAuthor(ids[index], record)
      if (author) authors.set(ids[index], author)
    })
    return authors
  }).subscribe({next: changed, error: () => {}})
  return () => sub.unsubscribe()
}

export async function shouldHideBulkPush(event: Event): Promise<boolean> {
  if (!isBulkPost(event)) return false
  try {
    const viewer = await localforage.getItem<string>(PUSH_VIEWER_KEY)
    if (!viewer) return true
    const follows = await localforage.getItem<string[]>(pushFollowsKey(viewer))
    if (follows?.includes(event.pubkey)) return !allowsBulkPost(event, viewer, true)
    const parent = immediateReplyTag(event)
    const record = parent
      ? await getMainThreadDb()
          .events.get(parent[1])
          .catch(() => undefined)
      : undefined
    return !allowsBulkPost(
      event,
      viewer,
      false,
      parent && signedParentAuthor(parent[1], record)
    )
  } catch {
    return true
  }
}
