import {calculateRelaySetFromEvent, type NDKEvent, type NDKRelaySet} from "./ndk"

/** Publish signed state without an optimistic cache entry or subscription echo. */
export async function publishConfirmedEvent(event: NDKEvent, supplied?: NDKRelaySet) {
  const instance = event.ndk
  if (!instance || !event.sig) throw new Error("A signed event is required.")
  const relays =
    supplied ??
    instance.devWriteRelaySet ??
    (await calculateRelaySetFromEvent(instance, event, 1))
  const accepted = await relays.publish(event, 10_000, 1)
  accepted.forEach((relay) => instance.subManager.seenEvent(event.id, relay))
  instance.subManager.dispatchEvent(event, undefined, true)
  return accepted
}
