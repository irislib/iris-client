import {NostrEvent} from "nostr-tools"

export const eventComparator = (
  [, a]: [string, NostrEvent],
  [, b]: [string, NostrEvent]
) => {
  if (b.created_at && a.created_at) return b.created_at - a.created_at
  return 0
}

export const INITIAL_DISPLAY_COUNT = 10
export const DISPLAY_INCREMENT = 10
