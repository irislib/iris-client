import {nip19} from "nostr-tools"
import {
  AppEvent,
  EventFilter,
  EventKind,
  getReplyTag,
  getRootEventId,
  getRootTag,
} from "@/lib/nostr"
import {KIND_REACTION, KIND_TEXT_NOTE, KIND_ZAP_RECEIPT} from "@/utils/constants"

export function getNotificationTarget(event: Pick<AppEvent, "id" | "kind" | "tags">) {
  if (event.kind === KIND_TEXT_NOTE) {
    const tags = event.tags.filter((tag) => tag[0] === "e")
    if (!tags.length) return undefined
    // A quoted post isn't the parent. If all references are mentions, the
    // notification concerns the note itself.
    return (
      getReplyTag({
        kind: event.kind,
        tags: tags.filter((tag) => tag[3] !== "mention"),
      })?.[1] ?? event.id
    )
  }
  if (event.kind === KIND_REACTION)
    return event.tags.filter((tag) => tag[0] === "e").at(-1)?.[1]
  return event.tags.find((tag) => tag[0] === "e")?.[1]
}

const HEX_EVENT_ID_REGEX = /^[0-9a-f]{64}$/i

export function getEventReplyReference(event: AppEvent): string | undefined {
  // A zap's event reference is its target, not a parent in a reply thread.
  if (event.kind === KIND_ZAP_RECEIPT) return undefined
  return getReplyTag(event)?.[1]
}

export function getEventRootReference(event: AppEvent): string | undefined {
  if (event.kind === KIND_ZAP_RECEIPT) return undefined
  return getRootTag(event)?.[1] ?? getRootEventId(event) ?? undefined
}

export function getHexEventIdFromThreadReference(
  reference?: string | null
): string | undefined {
  if (!reference || !HEX_EVENT_ID_REGEX.test(reference)) {
    return undefined
  }

  return reference
}

function parseAddressPointer(reference: string): nip19.AddressPointer | null {
  const [kindString, pubkey, ...identifierParts] = reference.split(":")

  if (!kindString || !pubkey || identifierParts.length === 0) {
    return null
  }

  const kind = Number(kindString)
  if (!Number.isInteger(kind) || kind < 0) {
    return null
  }

  return {
    kind,
    pubkey,
    identifier: identifierParts.join(":"),
  }
}

export function getThreadReferenceRoute(reference?: string): string | null {
  if (!reference) {
    return null
  }

  const eventId = getHexEventIdFromThreadReference(reference)
  if (eventId) {
    return `/${nip19.noteEncode(eventId)}`
  }

  const addressPointer = parseAddressPointer(reference)
  if (addressPointer) {
    return `/${nip19.naddrEncode(addressPointer)}`
  }

  return null
}

export function buildReplyFeedFilter(event: AppEvent): EventFilter {
  return {
    ...event.filter(),
    kinds: [KIND_TEXT_NOTE, EventKind.GenericReply],
  }
}

export function buildReplySubscriptionFilters(event: AppEvent): EventFilter[] {
  const filters: EventFilter[] = [
    {
      ...event.filter(),
      kinds: [KIND_TEXT_NOTE],
    },
  ]

  if (event.isParamReplaceable() || event.kind !== KIND_TEXT_NOTE) {
    filters.push({
      ...event.nip22Filter(),
      kinds: [EventKind.GenericReply],
    })
  }

  return filters
}
