import type {VerifiedEvent} from "nostr-tools"
const labelTag = (tag: string[]) =>
  tag[0] === "encrypted_device_labels" ||
  (tag[0] === "f" && tag[1] === "encrypted_device_labels")
export function hasLegacyPrivateRoster(event: VerifiedEvent): boolean {
  return event.kind === 37368 && event.tags.some(labelTag)
}
/** Signing a public roster is allowed; persisting ordinary private data with a static key is not. */
export function assertPrivatePublicationPolicy(event: VerifiedEvent): void {
  if (hasLegacyPrivateRoster(event))
    throw new Error(
      "Device list update needs confirmation; old private names remain local"
    )
  if (
    [10449, 10450, 10451, 10452, 10453, 21112].includes(event.kind) ||
    (event.kind === 30078 &&
      event.tags.some((tag) => tag[0] === "t" && tag[1] === "nostr-social-memory/v1"))
  ) {
    throw new Error("Private settings must use the encrypted device queue")
  }
}
/** Retire only an ACKed replacement of the exact intended public authorization. */
export function coversLegacyPrivateRoster(
  replacement: VerifiedEvent,
  blocked: VerifiedEvent
): boolean {
  if (
    replacement.kind !== 37368 ||
    hasLegacyPrivateRoster(replacement) ||
    !hasLegacyPrivateRoster(blocked) ||
    replacement.pubkey !== blocked.pubkey ||
    replacement.created_at < blocked.created_at ||
    replacement.content !== blocked.content
  )
    return false
  const tags = (event: VerifiedEvent) =>
    event.tags
      .filter((tag) => !labelTag(tag))
      .map((tag) => JSON.stringify(tag))
      .sort()
  return JSON.stringify(tags(replacement)) === JSON.stringify(tags(blocked))
}
