import {AppEvent, PublishError, NostrEvent} from "@/lib/nostr"
import {nostr} from "@/utils/nostrClient"
import {KIND_REACTION, KIND_TEXT_NOTE} from "./constants"
import {getEventGroup, inheritGroupTags} from "@/groups/activity"
import {publishGroupEvent} from "@/groups/publish"

export function isRelayPublishFailure(error: unknown): boolean {
  if (error instanceof PublishError) return true

  const message = error instanceof Error ? error.message : String(error)
  return (
    /^Not enough relays received the event\b/i.test(message) ||
    /^Publish timeout(?: after \d+ms)?$/i.test(message) ||
    /^Timeout: \d+ms$/i.test(message)
  )
}

export function getReactionPublishErrorMessage(error: unknown): string | null {
  if (isRelayPublishFailure(error)) return null

  const detail = error instanceof Error ? error.message : String(error)
  return detail
    ? `Could not publish reaction: ${detail}`
    : "Could not publish reaction. Please try again."
}

/**
 * React to an event with expiration inheritance
 * If the target event has an expiration tag, the reaction will inherit it
 */
export async function reactWithExpiration(
  event: AppEvent,
  content: string,
  extraTags: string[][] = []
): Promise<AppEvent> {
  const eventNdk = event.nostr ?? nostr()
  eventNdk.assertSigner()

  // Create reaction event
  const reactionEvent = new AppEvent(eventNdk, {
    kind: KIND_REACTION,
    content,
  } as NostrEvent)

  // Add reference to the event being reacted to
  reactionEvent.tag(event)

  // Add [ "k", kind ] for all non-kind:1 events
  if (event.kind !== KIND_TEXT_NOTE) {
    reactionEvent.tags.push(["k", `${event.kind}`])
  }

  // Get expiration from the target event and add it if present
  const expirationTag = event.tags.find((tag) => tag[0] === "expiration" && tag[1])
  if (expirationTag) {
    reactionEvent.tags.push(["expiration", expirationTag[1]])
  }

  reactionEvent.tags.push(...extraTags)
  reactionEvent.tags = inheritGroupTags(event, reactionEvent.tags)
  // Group writes wait for a relay acknowledgment before appearing successful.
  if (getEventGroup(event)) await publishGroupEvent(reactionEvent)
  else await reactionEvent.publish()

  return reactionEvent
}
