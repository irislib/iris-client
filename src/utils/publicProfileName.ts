// Keep the current public name separate from the locally accepted contact name.
export function publicProfileName(
  profile?: {
    display_name?: unknown
    displayName?: unknown
    name?: unknown
    username?: unknown
    nip05?: unknown
  } | null
): string | null {
  for (const value of [
    profile?.display_name,
    profile?.displayName,
    profile?.name,
    profile?.username,
  ]) {
    if (typeof value === "string" && value.trim()) return value
  }
  return typeof profile?.nip05 === "string" && profile.nip05.trim()
    ? profile.nip05.split("@")[0] || null
    : null
}
