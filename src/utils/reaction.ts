import {NDKEvent, NDKPublishError, NostrEvent} from "@/lib/ndk"
import {ndk} from "@/utils/ndk"
import {KIND_REACTION, KIND_TEXT_NOTE} from "./constants"

export function isRelayPublishFailure(error: unknown): boolean {
  if (error instanceof NDKPublishError) return true

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
  event: NDKEvent,
  content: string
): Promise<NDKEvent> {
  const eventNdk = event.ndk ?? ndk()
  eventNdk.assertSigner()

  // Create reaction event
  const reactionEvent = new NDKEvent(eventNdk, {
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

  // Sign and publish
  await reactionEvent.publish()

  return reactionEvent
}
