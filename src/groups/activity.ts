import {verifyEvent, type Event} from "nostr-tools"
import {groupAddress, groupTags, type GroupRef} from "./model"

type TaggedEvent = {pubkey: string; tags: string[][]; rawEvent?: () => unknown}
export type GroupActivityAccess = {
  ref: GroupRef
  isVisibleMember: (pubkey: string) => boolean
}
const signatures = new WeakMap<object, {fingerprint: string; valid: boolean}>()

function validSignature(event: TaggedEvent, raw: Event): boolean {
  const protocol = {
    id: raw.id,
    pubkey: raw.pubkey,
    sig: raw.sig,
    kind: raw.kind,
    created_at: raw.created_at,
    content: raw.content,
    tags: raw.tags,
  }
  const fingerprint = JSON.stringify(protocol)
  const cached = signatures.get(event)
  if (cached?.fingerprint === fingerprint) return cached.valid
  // Exclude nostr-tools' cached symbol; a copied or mutated object must be verified.
  const valid = verifyEvent(protocol)
  signatures.set(event, {fingerprint, valid})
  return valid
}

export function getEventGroup(event?: {tags: string[][]}): GroupRef | null {
  if (!event) return null
  const groups = event.tags.filter((tag) => tag[0] === "h")
  if (groups.length !== 1 || groups[0].length !== 2) return null
  const id = groups[0][1]
  if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(id ?? "")) return null
  const addresses = event.tags.filter(
    (tag) => tag[0] === "a" && tag[1]?.startsWith("37368:")
  )
  if (addresses.length !== 1) return null
  const parts = addresses[0][1].split(":")
  if (parts.length !== 3) return null
  const [kind, creator, subject] = parts
  return kind === "37368" && subject === id && /^[0-9a-f]{64}$/.test(creator)
    ? {id, creator}
    : null
}

export function inheritGroupTags(
  target: {tags: string[][]},
  tags: string[][]
): string[][] {
  const ref = getEventGroup(target)
  if (!ref) return tags
  return [
    ...tags.filter(
      (tag) => tag[0] !== "h" && !(tag[0] === "a" && tag[1]?.startsWith("37368:"))
    ),
    ...groupTags(ref),
  ]
}

/** Raw activity can be cached; visibility uses the same current trust boundary as posts. */
export function isVisibleGroupActivity(
  event: TaggedEvent,
  access: GroupActivityAccess | null
): boolean {
  if (!access) return true
  return (
    access.isVisibleMember(event.pubkey) && isAuthenticGroupActivity(event, access.ref)
  )
}

export function isAuthenticGroupActivity(event: TaggedEvent, group: GroupRef): boolean {
  const ref = getEventGroup(event)
  if (!ref || groupAddress(ref) !== groupAddress(group)) return false
  try {
    const raw = (event.rawEvent?.() ?? event) as Event
    const now = Math.floor(Date.now() / 1000)
    const expiration = raw.tags.find((tag) => tag[0] === "expiration")?.[1]
    return (
      raw.created_at <= now &&
      (!expiration || Number(expiration) > now) &&
      validSignature(event, raw)
    )
  } catch {
    return false
  }
}

/** A receipt's signer is the payment service; membership belongs to its signed request author. */
export function isVisibleGroupZap(
  zap: {pubkey: string; event: {tags: string[][]}},
  targetId: string,
  access: GroupActivityAccess | null
): boolean {
  if (!access) return true
  try {
    const description = zap.event.tags.find((tag) => tag[0] === "description")?.[1]
    const request = JSON.parse(description ?? "") as Event
    return (
      request.kind === 9734 &&
      request.pubkey === zap.pubkey &&
      request.tags.some((tag) => tag[0] === "e" && tag[1] === targetId) &&
      isVisibleGroupActivity(request, access)
    )
  } catch {
    return false
  }
}
