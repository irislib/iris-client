/** NIP-88 poll semantics. Callers supply signature-verified events. */
export const KIND_POLL = 1068
export const KIND_POLL_RESPONSE = 1018

export interface PollEvent {
  id: string
  pubkey: string
  kind?: number
  created_at?: number
  content: string
  tags: string[][]
}

export type PollType = "singlechoice" | "multiplechoice"
export interface Poll {
  id: string
  question: string
  createdAt: number
  options: {id: string; label: string}[]
  type: PollType
  endsAt?: number
  relays: string[]
}

const isHex = (value: string) => /^[0-9a-f]{64}$/.test(value)
const isTimestamp = (value: number | undefined): value is number =>
  value !== undefined && Number.isSafeInteger(value) && value >= 0

export function pollRelayUrls(values: readonly string[]): string[] {
  const urls = new Set<string>()
  for (const value of values) {
    try {
      const url = new URL(value)
      if (
        (url.protocol === "ws:" || url.protocol === "wss:") &&
        !url.username &&
        !url.password
      ) {
        urls.add(url.href)
      }
    } catch {
      // Invalid relay hints do not change the meaning of a poll.
    }
  }
  return [...urls]
}

export function parsePoll(event: PollEvent): Poll | null {
  if (
    event.kind !== KIND_POLL ||
    !isHex(event.id) ||
    !isHex(event.pubkey) ||
    !isTimestamp(event.created_at) ||
    !event.content.trim()
  )
    return null
  const options = event.tags
    .filter((tag) => tag[0] === "option")
    .map((tag) => ({id: tag[1], label: tag[2]}))
  if (
    options.length < 2 ||
    options.some(({id, label}) => !id || !/^[a-zA-Z0-9]+$/.test(id) || !label?.trim()) ||
    new Set(options.map(({id}) => id)).size !== options.length
  )
    return null
  const typeTags = event.tags.filter((tag) => tag[0] === "polltype")
  const type = typeTags.length ? typeTags[0][1] : "singlechoice"
  if (typeTags.length > 1 || (type !== "singlechoice" && type !== "multiplechoice"))
    return null
  const endTags = event.tags.filter((tag) => tag[0] === "endsAt")
  const endsAt = endTags.length ? Number(endTags[0][1]) : undefined
  if (
    endTags.length > 1 ||
    (endTags.length &&
      (!/^\d+$/.test(endTags[0][1] ?? "") ||
        !isTimestamp(endsAt) ||
        endsAt < event.created_at))
  )
    return null
  return {
    id: event.id,
    question: event.content,
    createdAt: event.created_at,
    options,
    type,
    endsAt,
    relays: pollRelayUrls(
      event.tags.filter((tag) => tag[0] === "relay").map((tag) => tag[1])
    ),
  }
}

export interface PollResponse {
  event: PollEvent
  selections: string[]
}

export function parsePollResponse(
  poll: Poll,
  event: PollEvent,
  now = Math.floor(Date.now() / 1000)
): PollResponse | null {
  if (
    event.kind !== KIND_POLL_RESPONSE ||
    !isHex(event.id) ||
    !isHex(event.pubkey) ||
    !isTimestamp(event.created_at) ||
    event.created_at < poll.createdAt ||
    event.created_at > now ||
    (poll.endsAt !== undefined && event.created_at > poll.endsAt)
  )
    return null
  const references = event.tags.filter((tag) => tag[0] === "e")
  if (references.length !== 1 || references[0][1] !== poll.id) return null
  const responseTags = event.tags.filter((tag) => tag[0] === "response")
  // NIP-88 expressly uses the first response for single-choice polls.
  const selections = [
    ...new Set(
      (poll.type === "singlechoice" ? responseTags.slice(0, 1) : responseTags).map(
        (tag) => tag[1]
      )
    ),
  ]
  if (
    !selections.length ||
    selections.some((id) => !poll.options.some((option) => option.id === id))
  )
    return null
  return {event, selections}
}

export function tallyPollResponses(
  poll: Poll,
  events: Iterable<PollEvent>,
  {
    now = Math.floor(Date.now() / 1000),
    isEligible = () => true,
  }: {
    now?: number
    isEligible?: (pubkey: string) => boolean
  } = {}
) {
  const responsesByPubkey = new Map<string, PollResponse>()
  for (const event of events) {
    const response = parsePollResponse(poll, event, now)
    if (!response || !isEligible(event.pubkey)) continue
    const previous = responsesByPubkey.get(event.pubkey)?.event
    // NIP-88 leaves timestamp ties undefined; lower event ID is our stable tie-break.
    if (
      !previous ||
      event.created_at! > previous.created_at! ||
      (event.created_at === previous.created_at && event.id < previous.id)
    ) {
      responsesByPubkey.set(event.pubkey, response)
    }
  }
  const counts: Record<string, number> = Object.fromEntries(
    poll.options.map(({id}) => [id, 0])
  )
  for (const response of responsesByPubkey.values()) {
    for (const id of response.selections) counts[id]++
  }
  return {counts, total: responsesByPubkey.size, responsesByPubkey}
}

export function buildPollTags({
  options,
  type = "singlechoice",
  endsAt,
  relays = [],
}: {
  options: readonly string[]
  type?: PollType
  endsAt?: number
  relays?: readonly string[]
}): string[][] {
  if (options.length < 2 || options.some((option) => !option.trim()))
    throw new Error("Add at least two choices.")
  if (type !== "singlechoice" && type !== "multiplechoice")
    throw new Error("Unsupported poll type.")
  if (endsAt !== undefined && !isTimestamp(endsAt))
    throw new Error("Choose a valid poll duration.")
  return [
    ...options.map((label, index) => ["option", String(index + 1), label.trim()]),
    ["polltype", type],
    ...(endsAt !== undefined ? [["endsAt", String(endsAt)]] : []),
    ...pollRelayUrls(relays).map((url) => ["relay", url]),
  ]
}

export function buildPollResponseTags(
  poll: Poll,
  optionIds: readonly string[]
): string[][] {
  const ids = [...new Set(optionIds)]
  if (
    !ids.length ||
    (poll.type === "singlechoice" && ids.length !== 1) ||
    ids.some((id) => !poll.options.some((option) => option.id === id))
  )
    throw new Error("Choose a valid poll option.")
  return [["e", poll.id], ...ids.map((id) => ["response", id])]
}
