import {verifyEvent} from "nostr-tools"
import type {NDKEvent} from "../lib/ndk/events"

export interface WasmEventVerifier {
  verifyEvent(event: unknown): void
}

export function verifyRelayEvent(
  event: NDKEvent,
  wasmVerifier: WasmEventVerifier | null
): boolean {
  try {
    if (wasmVerifier) {
      wasmVerifier.verifyEvent({
        id: event.id,
        sig: event.sig,
        pubkey: event.pubkey,
        content: event.content,
        kind: event.kind,
        created_at: event.created_at,
        tags: event.tags,
      })
      return true
    }

    return verifyEvent(event.rawEvent())
  } catch {
    return false
  }
}
