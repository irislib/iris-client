import {isPrivateRelayEvent, type NostrFilter, type RuntimeSource} from "nostr-pubsub"

const inboxFields = new Set(["kinds", "authors", "#p", "since", "until", "limit"])

function isInbox(filter: NostrFilter) {
  return (
    !!filter.kinds?.length &&
    filter.kinds.every((kind) => isPrivateRelayEvent({kind})) &&
    !!(filter.authors?.length || filter["#p"]?.length) &&
    Object.keys(filter).every((key) => inboxFields.has(key))
  )
}

/** Application reads on Nostr peer streams are exclusively inbox interests.
 * Public browsing uses separate relay and Hashtree sources. */
export function irisMessagingSource(source: RuntimeSource): RuntimeSource {
  return {
    ...source,
    async subscribe(filters, handler) {
      const inbox = filters.filter(isInbox)
      return inbox.length ? source.subscribe!(inbox, handler) : {close() {}}
    },
    async query(filters, options) {
      const inbox = filters.filter(isInbox)
      return inbox.length ? source.query!(inbox, options) : {events: [], complete: true}
    },
  }
}
