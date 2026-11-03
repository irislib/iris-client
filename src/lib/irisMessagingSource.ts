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

/** Public views read the fixed feed locally. Only addressed, encrypted inbox
 * requests pass their filters through to the messaging endpoint. */
export function irisMessagingSource(
  messaging: RuntimeSource,
  feed: RuntimeSource
): RuntimeSource {
  function routes(filters: NostrFilter[]) {
    const inbox = filters.filter(isInbox)
    const local = filters.filter((filter) => !isInbox(filter))
    return [
      ...(local.length ? [{source: feed, filters: local}] : []),
      ...(inbox.length ? [{source: messaging, filters: inbox}] : []),
    ]
  }
  return {
    id: messaging.id,
    publishAcceptance: messaging.publishAcceptance,
    publish: (event, origin) =>
      (isPrivateRelayEvent(event) ? messaging : feed).publish!(event, origin),
    async subscribe(filters, handler) {
      const handles = await Promise.allSettled(
        routes(filters).map(async (r) => r.source.subscribe!(r.filters, handler))
      )
      const close = () => {
        for (const handle of handles)
          if (handle.status === "fulfilled") handle.value.close()
      }
      const failed = handles.find((handle) => handle.status === "rejected")
      if (failed) {
        close()
        throw failed.reason
      }
      return {close}
    },
    async query(filters, options) {
      const reports = await Promise.all(
        routes(filters).map((r) => r.source.query!(r.filters, options))
      )
      return {
        events: reports.flatMap((report) => report.events),
        complete: reports.every((report) => report.complete !== false),
      }
    },
  }
}
