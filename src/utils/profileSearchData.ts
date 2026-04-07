export type SearchResult = {
  name: string
  pubKey: string
  nip05?: string
  aliases?: string[]
  picture?: string
  created_at?: number
}

const PROFILE_NAME_MAX_LENGTH = 100

function normalizeNameValue(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined
  }

  const trimmed = value.split(/\s+/).filter(Boolean).join(" ")
  if (!trimmed) {
    return undefined
  }

  return trimmed.slice(0, PROFILE_NAME_MAX_LENGTH)
}

function normalizePictureValue(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined
  }

  const trimmed = value.trim()
  return trimmed || undefined
}

export function extractProfileSearchNames(profile: Record<string, unknown>): string[] {
  const candidates = [
    profile.display_name,
    profile.displayName,
    profile.name,
    profile.username,
  ]

  const names: string[] = []
  const seen = new Set<string>()

  for (const candidate of candidates) {
    const normalized = normalizeNameValue(candidate)
    if (!normalized) {
      continue
    }

    const key = normalized.toLowerCase()
    if (seen.has(key)) {
      continue
    }

    seen.add(key)
    names.push(normalized)
  }

  return names
}

function shouldRejectNip05(nip05: string, name: string): boolean {
  if (nip05.length === 1 || nip05.startsWith("npub1")) {
    return true
  }

  return name.toLowerCase().replace(/\s+/g, "").includes(nip05)
}

export function normalizeProfileSearchNip05(
  value: unknown,
  primaryName?: string
): string | undefined {
  if (typeof value !== "string") {
    return undefined
  }

  const localPart = value
    .split("@")[0]
    ?.trim()
    .toLowerCase()
    .slice(0, PROFILE_NAME_MAX_LENGTH)
  if (!localPart) {
    return undefined
  }

  if (primaryName && shouldRejectNip05(localPart, primaryName)) {
    return undefined
  }

  return localPart
}

export function buildProfileSearchResult(
  pubKey: string,
  profile: Record<string, unknown>,
  created_at?: number
): SearchResult | undefined {
  const names = extractProfileSearchNames(profile)
  const name = names[0]
  if (!name) {
    return undefined
  }

  const aliases = names.slice(1)
  let resolvedCreatedAt: number | undefined
  if (typeof created_at === "number") {
    resolvedCreatedAt = created_at
  } else if (typeof profile.created_at === "number") {
    resolvedCreatedAt = profile.created_at
  }

  return {
    pubKey,
    name,
    aliases: aliases.length > 0 ? aliases : undefined,
    nip05: normalizeProfileSearchNip05(profile.nip05, name),
    picture: normalizePictureValue(profile.picture),
    created_at: resolvedCreatedAt,
  }
}

export function hasProfileSearchPrefixMatch(
  result: Pick<SearchResult, "name" | "nip05" | "aliases">,
  query: string
): boolean {
  const normalizedQuery = query.toLowerCase()

  if (result.name.toLowerCase().startsWith(normalizedQuery)) {
    return true
  }

  if (result.nip05?.toLowerCase().startsWith(normalizedQuery)) {
    return true
  }

  return (
    result.aliases?.some((alias) => alias.toLowerCase().startsWith(normalizedQuery)) ??
    false
  )
}

export function hasProfileSearchExactMatch(
  result: Pick<SearchResult, "name" | "nip05" | "aliases">,
  query: string
): boolean {
  const normalizedQuery = query.toLowerCase()

  if (result.name.toLowerCase() === normalizedQuery) {
    return true
  }

  if (result.nip05?.toLowerCase() === normalizedQuery) {
    return true
  }

  return result.aliases?.some((alias) => alias.toLowerCase() === normalizedQuery) ?? false
}

export function hasProfileSearchTextMatch(
  result: Pick<SearchResult, "name" | "nip05" | "aliases" | "pubKey">,
  query: string
): boolean {
  const tokens = query.toLowerCase().trim().split(/\s+/).filter(Boolean)

  if (tokens.length === 0) {
    return false
  }

  const fields = [result.name, result.nip05, result.pubKey, ...(result.aliases ?? [])]
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .map((value) => value.toLowerCase())

  return tokens.every((token) => fields.some((field) => field.includes(token)))
}
