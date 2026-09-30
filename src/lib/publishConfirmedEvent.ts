import {calculateRelaySetFromEvent, type AppEvent, type RelaySet} from "@/lib/nostr"

/** Publish signed state without an optimistic cache entry or subscription echo. */
export async function publishConfirmedEvent(event: AppEvent, supplied?: RelaySet) {
  const instance = event.nostr
  if (!instance || !event.sig) throw new Error("A signed event is required.")
  const relays =
    supplied ??
    instance.devWriteRelaySet ??
    (await calculateRelaySetFromEvent(instance, event, 1))
  event.publishStatus = "pending"
  // One positive acknowledgement confirms delivery. Other relays keep publishing
  // in the background; a silent relay must not hold a confirmed draft open.
  const first = await Promise.any(
    [...relays.relays].map(async (relay) => {
      if (!(await relay.publish(event, 10_000))) throw new Error("Publish rejected")
      return relay
    })
  ).catch(() => {
    event.publishStatus = "error"
    throw new Error("No relay confirmed the event.")
  })
  event.publishStatus = "success"
  const accepted = new Set([first])
  event.emit("published", {relaySet: relays, publishedToRelays: accepted})
  accepted.forEach((relay) => instance.subManager.seenEvent(event.id, relay))
  instance.subManager.dispatchEvent(event, undefined, true)
  return accepted
}
