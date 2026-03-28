import {nip19} from "nostr-tools"
import {
  NDKEvent,
  NDKFilter,
  NDKKind,
  getReplyTag,
  getRootEventId,
  getRootTag,
} from "@/lib/ndk"
import {KIND_TEXT_NOTE} from "@/utils/constants"

const HEX_EVENT_ID_REGEX = /^[0-9a-f]{64}$/i

export function getEventReplyReference(event: NDKEvent): string | undefined {
  return getReplyTag(event)?.[1]
}

export function getEventRootReference(event: NDKEvent): string | undefined {
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

export function buildReplyFeedFilter(event: NDKEvent): NDKFilter {
  return {
    ...event.filter(),
    kinds: [KIND_TEXT_NOTE, NDKKind.GenericReply],
  }
}

export function buildReplySubscriptionFilters(event: NDKEvent): NDKFilter[] {
  const filters: NDKFilter[] = [
    {
      ...event.filter(),
      kinds: [KIND_TEXT_NOTE],
    },
  ]

  if (event.isParamReplaceable() || event.kind !== KIND_TEXT_NOTE) {
    filters.push({
      ...event.nip22Filter(),
      kinds: [NDKKind.GenericReply],
    })
  }

  return filters
}
