import {AppEvent, Relay, RelaySet} from "@/lib/nostr"
import {getWorkerTransport, nostr} from "@/utils/nostrClient"
import {cacheEvent} from "@/utils/eventCache"
import {useUserStore} from "@/stores/user"
import {publishConfirmedEvent} from "@/lib/publishConfirmedEvent"

const lastSignedAt = new Map<string, number>()
const signingQueues = new Map<string, Promise<void>>()

type SigningWindow = {afterTimestamp?: number; beforeTimestamp?: number}

async function signInOrder(event: AppEvent, window: SigningWindow) {
  const author = useUserStore.getState().publicKey
  const previous = signingQueues.get(author) ?? Promise.resolve()
  const signing = previous
    .catch(() => {})
    .then(async () => {
      const last = Math.max(lastSignedAt.get(author) ?? 0, window.afterTimestamp ?? 0)
      if (last) {
        const delay = (last + 1) * 1000 - Date.now()
        if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay))
      }
      if (!author || author !== useUserStore.getState().publicKey) {
        throw new Error("Your account changed. Please try again.")
      }
      event.created_at = Math.floor(Date.now() / 1000)
      if (
        window.beforeTimestamp !== undefined &&
        event.created_at > window.beforeTimestamp
      ) {
        throw new Error("This poll has closed.")
      }
      await event.sign()
      if (event.pubkey !== author)
        throw new Error("The signer changed. Please try again.")
      lastSignedAt.set(author, event.created_at)
    })
  signingQueues.set(author, signing)
  try {
    await signing
  } finally {
    if (signingQueues.get(author) === signing) signingQueues.delete(author)
  }
}

/** Group writes are successful only after a relay acknowledges the signed event. */
export async function publishGroupEvent(
  draft: {kind: number; content: string; tags: string[][]} | AppEvent,
  relayUrls?: string[],
  window: SigningWindow = {}
): Promise<AppEvent> {
  const instance = nostr()
  const event = draft instanceof AppEvent ? draft : new AppEvent(instance, draft)
  event.nostr = instance
  if (!event.sig) await signInOrder(event, window)
  if (event.pubkey !== useUserStore.getState().publicKey)
    throw new Error("Your account changed. Please try again.")
  if (
    window.beforeTimestamp !== undefined &&
    Math.floor(Date.now() / 1000) > window.beforeTimestamp
  ) {
    throw new Error("This poll has closed.")
  }
  const transport = getWorkerTransport()
  if (transport) {
    await transport.publish(
      event,
      relayUrls?.map((url) => new Relay(url, undefined, instance)),
      {requireAck: true}
    )
  } else {
    const relaySet = relayUrls?.length
      ? RelaySet.fromRelayUrls(relayUrls, instance)
      : undefined
    await publishConfirmedEvent(event, relaySet)
  }
  cacheEvent(event)
  if (transport) instance.subManager.dispatchEvent(event, undefined, true)
  return event
}
