import {hasMetadataPrivacyVersion, isGroupRosterFactEvent} from "nostr-double-ratchet"
import type {VerifiedEvent} from "nostr-tools"
const labelTag = (tag: string[]) =>
  tag[0] === "encrypted_device_labels" ||
  (tag[0] === "f" && tag[1] === "encrypted_device_labels")
export function hasLegacyPrivateRoster(event: VerifiedEvent): boolean {
  return event.kind === 37368 && event.tags.some(labelTag)
}
/** Public device authorization is allowed; private communication uses session keys. */
export function assertPrivatePublicationPolicy(event: VerifiedEvent): void {
  const invite =
    event.kind === 30078 &&
    event.tags.some(
      (tag) => tag[0] === "d" && tag[1]?.startsWith("double-ratchet/invites/")
    )
  if (([1059, 1060].includes(event.kind) || invite) && !hasMetadataPrivacyVersion(event))
    throw new Error(
      "Old private ciphertext cannot be resent; start a new encrypted session"
    )
  if (
    (event.kind === 1060 && !event.tags.some((tag) => tag[0] === "p")) ||
    isGroupRosterFactEvent(event)
  )
    throw new Error("Private groups must use encrypted device sessions")
  if (hasLegacyPrivateRoster(event))
    throw new Error(
      "Device list update needs confirmation; old private names remain local"
    )
  if (
    [10449, 10450, 10451, 10452, 10453, 21111, 21112].includes(event.kind) ||
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
