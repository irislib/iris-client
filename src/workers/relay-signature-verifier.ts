import {verifyEvent, type Event} from "nostr-tools"
import type {AppEvent} from "@/lib/nostr"

export interface WasmEventVerifier {
  verifyEvent(event: unknown): void
}

export function verifyRelayEvent(
  event: AppEvent | Event,
  wasmVerifier: WasmEventVerifier | null
): boolean {
  try {
    const raw = {
      id: event.id,
      sig: event.sig,
      pubkey: event.pubkey,
      content: event.content,
      kind: event.kind,
      created_at: event.created_at,
      tags: event.tags,
    }
    if (wasmVerifier) {
      wasmVerifier.verifyEvent(raw)
      return true
    }
    return verifyEvent(raw)
  } catch {
    return false
  }
}
