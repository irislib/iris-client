import {nip19} from "nostr-tools"
import {nostr} from "@/utils/nostrClient"
import {NOSTR_REGEX, HEX_REGEX, NIP05_REGEX} from "@/utils/validation"
import {AppEvent} from "@/lib/nostr"

export type IdentifierResult =
  | {type: "npub"; data: string}
  | {type: "note"; data: string}
  | {type: "nevent"; data: nip19.EventPointer}
  | {type: "naddr"; data: nip19.AddressPointer}
  | {type: "nprofile"; data: nip19.ProfilePointer}
  | {type: "hex"; data: string}
  | {type: "nip05"; data: string}
  | {type: "text"; data: string}

export async function parseNostrIdentifier(input: string): Promise<IdentifierResult> {
  const trimmed = input.trim()

  // Check for bech32 encoded identifiers
  if (trimmed.match(NOSTR_REGEX)) {
    try {
      const result = nip19.decode(trimmed)
      switch (result.type) {
        case "npub":
          return {type: "npub", data: result.data}
        case "note":
          return {type: "note", data: result.data}
        case "nevent":
          return {type: "nevent", data: result.data}
        case "naddr":
          return {type: "naddr", data: result.data}
        case "nprofile":
          return {type: "nprofile", data: result.data}
      }
    } catch (e) {
      // Fall through to text search
    }
  }

  // Check for hex pubkey/event id (64 chars)
  if (trimmed.match(HEX_REGEX) && trimmed.length === 64) {
    // Try to fetch as both user and event
    const ndkInstance = nostr()

    // Create subscriptions for both author and event ID
    const userSub = ndkInstance.subscribe({
      authors: [trimmed],
      limit: 1,
    })

    const eventSub = ndkInstance.subscribe({
      ids: [trimmed],
      limit: 1,
    })

    // Wait for either to return a result
    const result = await new Promise<{type: "user" | "event"; data: string}>(
      (resolve) => {
        let resolved = false

        userSub.on("event", () => {
          if (!resolved) {
            resolved = true
            userSub.stop()
            eventSub.stop()
            resolve({type: "user", data: trimmed})
          }
        })

        eventSub.on("event", (event: AppEvent) => {
          if (!resolved) {
            resolved = true
            userSub.stop()
            eventSub.stop()
            resolve({type: "event", data: event.id})
          }
        })

        // Also listen for eose (end of stored events) to handle when nothing is found
        let userEose = false
        let eventEose = false

        userSub.on("eose", () => {
          userEose = true
          if (eventEose && !resolved) {
            resolved = true
            userSub.stop()
            eventSub.stop()
            // Default to user if nothing found
            resolve({type: "user", data: trimmed})
          }
        })

        eventSub.on("eose", () => {
          eventEose = true
          if (userEose && !resolved) {
            resolved = true
            userSub.stop()
            eventSub.stop()
            // Default to user if nothing found
            resolve({type: "user", data: trimmed})
          }
        })
      }
    )

    if (result.type === "event") {
      return {type: "note", data: result.data}
    } else {
      return {type: "hex", data: trimmed}
    }
  }

  // Check for NIP-05 identifier
  if (trimmed.match(NIP05_REGEX)) {
    try {
      const user = await nostr().getUserFromNip05(trimmed)
      if (user) {
        return {type: "nip05", data: user.pubkey}
      }
    } catch (e) {
      // Fall through to text search
    }
  }

  // Default to text search
  return {type: "text", data: trimmed}
}
