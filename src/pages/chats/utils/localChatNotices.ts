import {getMillisecondTimestamp} from "nostr-double-ratchet"
import type {MessageType} from "../message/Message"

export interface LocalChatNotice {
  id: string
  timestamp: number
  content: string
}

export type ChatTimelineEntry =
  | {type: "messages"; timestamp: number; messages: MessageType[]}
  | {type: "notice"; timestamp: number; notice: LocalChatNotice}

// Notices remain outside the message store, so they cannot be sent or get receipts.
export function withLocalChatNotices(
  groups: MessageType[][],
  notices: LocalChatNotice[],
  showEarlier: boolean
): ChatTimelineEntry[] {
  const firstTimestamp = groups[0]?.[0] ? getMillisecondTimestamp(groups[0][0]) : 0
  const pending = notices
    .filter((notice) => showEarlier || notice.timestamp >= firstTimestamp)
    .slice()
    .sort((a, b) => a.timestamp - b.timestamp)
  const result: ChatTimelineEntry[] = []
  let noticeIndex = 0
  const addNoticesBefore = (timestamp: number) => {
    while (noticeIndex < pending.length && pending[noticeIndex].timestamp < timestamp) {
      const notice = pending[noticeIndex++]
      result.push({type: "notice", timestamp: notice.timestamp, notice})
    }
  }
  for (const group of groups) {
    let segment: MessageType[] = []
    const flush = () => {
      if (segment.length)
        result.push({
          type: "messages",
          timestamp: getMillisecondTimestamp(segment[0]),
          messages: segment,
        })
      segment = []
    }
    for (const message of group) {
      const timestamp = getMillisecondTimestamp(message)
      if (noticeIndex < pending.length && pending[noticeIndex].timestamp < timestamp) {
        flush()
        addNoticesBefore(timestamp)
      }
      segment.push(message)
    }
    flush()
  }
  addNoticesBefore(Infinity)
  return result
}
