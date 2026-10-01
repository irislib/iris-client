// Vendored from nostr-social-graph ts/src/contactMemory.ts (MIT, unreleased API).
// Keep this portable policy in sync with the library until a release is available.
/**
 * Private contact memory, portable between storage adapters and applications.
 * Keep one record per viewing account and contact. Never publish this as profile
 * metadata or infer public follows / social trust from the favorite flag.
 */
export interface ContactMemory {
  first_seen_name: string | null
  accepted_name: string | null
  favorite: boolean
  name_changes: AcceptedNameChange[]
}

export interface AcceptedNameChange {
  previous_name: string
  accepted_name: string
  accepted_at_secs: number
}

export function emptyContactMemory(): ContactMemory {
  return {
    first_seen_name: null,
    accepted_name: null,
    favorite: false,
    name_changes: [],
  }
}

/** Call after an interaction, not for every profile that happens to be fetched. */
export function observeContactName(
  memory: ContactMemory,
  name: string | null
): ContactMemory {
  if (!name?.trim()) return memory
  if (memory.first_seen_name !== null && memory.accepted_name !== null) return memory
  return {
    ...memory,
    first_seen_name: memory.first_seen_name ?? name,
    accepted_name: memory.accepted_name ?? name,
  }
}

/** The latest public name is transient and remains outside private memory. */
export function pendingContactName(
  memory: ContactMemory,
  currentName: string | null
): string | null {
  return currentName?.trim() &&
    memory.accepted_name !== null &&
    memory.accepted_name !== currentName
    ? currentName
    : null
}

/**
 * Apply an explicit approval only if the name shown in the confirmation still
 * matches the latest profile. Return the original record for a stale approval.
 */
export function approveContactName(
  memory: ContactMemory,
  expectedName: string,
  currentName: string | null,
  nowSecs: number
): ContactMemory {
  if (
    !expectedName.trim() ||
    expectedName !== currentName ||
    memory.accepted_name === null ||
    memory.accepted_name === expectedName ||
    !Number.isSafeInteger(nowSecs) ||
    nowSecs < 0
  )
    return memory
  return {
    ...memory,
    accepted_name: expectedName,
    name_changes: [
      ...memory.name_changes,
      {
        previous_name: memory.accepted_name,
        accepted_name: expectedName,
        accepted_at_secs: nowSecs,
      },
    ],
  }
}

export function setContactFavorite(
  memory: ContactMemory,
  favorite: boolean
): ContactMemory {
  return memory.favorite === favorite ? memory : {...memory, favorite}
}
