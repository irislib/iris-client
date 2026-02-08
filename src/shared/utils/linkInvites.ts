import {Invite} from "nostr-double-ratchet"

const DEFAULT_LINK_INVITE_ROOTS = ["https://iris.to", "https://chat.iris.to"]

type LinkInvitePayload = {
  inviter?: string
  ephemeralKey?: string
  inviterEphemeralPublicKey?: string
  sharedSecret?: string
  purpose?: string
  owner?: string
  ownerPubkey?: string
}

function parseInvitePayload(url: string): {purpose?: string; owner?: string} | null {
  try {
    const parsed = new URL(url)
    const rawHash = parsed.hash.slice(1)
    if (!rawHash) return null
    const decoded = decodeURIComponent(rawHash)
    const data = JSON.parse(decoded) as Record<string, unknown>
    if (!data || typeof data !== "object") return null

    let owner: string | undefined
    if (typeof data.owner === "string") {
      owner = data.owner
    } else if (typeof data.ownerPubkey === "string") {
      owner = data.ownerPubkey
    }

    return {
      purpose: typeof data.purpose === "string" ? data.purpose : undefined,
      owner,
    }
  } catch {
    return null
  }
}

function normalizeInvitePayload(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed) return null

  const decoded = trimmed.startsWith("%7B") ? decodeURIComponent(trimmed) : trimmed
  if (!decoded.startsWith("{")) return null

  let data: LinkInvitePayload
  try {
    data = JSON.parse(decoded) as LinkInvitePayload
  } catch {
    return null
  }

  if (!data || typeof data !== "object") return null

  const inviter = typeof data.inviter === "string" ? data.inviter : undefined
  const sharedSecret =
    typeof data.sharedSecret === "string" ? data.sharedSecret : undefined

  let ephemeralKey: string | undefined
  if (typeof data.ephemeralKey === "string") {
    ephemeralKey = data.ephemeralKey
  } else if (typeof data.inviterEphemeralPublicKey === "string") {
    ephemeralKey = data.inviterEphemeralPublicKey
  }

  if (!inviter || !sharedSecret || !ephemeralKey) return null

  const payload: Record<string, string> = {
    inviter,
    ephemeralKey,
    sharedSecret,
  }

  const purpose = typeof data.purpose === "string" ? data.purpose : undefined

  let owner: string | undefined
  if (typeof data.owner === "string") {
    owner = data.owner
  } else if (typeof data.ownerPubkey === "string") {
    owner = data.ownerPubkey
  }

  if (purpose) payload.purpose = purpose
  if (owner) payload.owner = owner

  return JSON.stringify(payload)
}

function normalizeInvitePayloadFromUrl(rawUrl: string): string | null {
  try {
    const parsed = new URL(rawUrl)
    const rawHash = parsed.hash.slice(1)
    if (!rawHash) return null
    const decoded = decodeURIComponent(rawHash)
    return normalizeInvitePayload(decoded)
  } catch {
    return null
  }
}

export function parseLinkInviteInput(
  input: string,
  ownerPubkey: string,
  roots: string[] = DEFAULT_LINK_INVITE_ROOTS
): Invite | null {
  const trimmed = input.trim()
  if (!trimmed) return null

  let cleaned = trimmed
  if (cleaned.startsWith("nostr:")) {
    cleaned = cleaned.slice("nostr:".length)
  }

  const candidates: string[] = []

  if (cleaned.includes("://")) {
    candidates.push(cleaned)
  }

  if (cleaned.startsWith("#")) {
    for (const root of roots) {
      candidates.push(`${root}${cleaned}`)
    }
  }

  if (!cleaned.includes("://")) {
    const hash = cleaned.startsWith("{") ? encodeURIComponent(cleaned) : cleaned
    for (const root of roots) {
      candidates.push(`${root}#${hash.replace(/^#/, "")}`)
    }
  }

  const normalizedPayload = normalizeInvitePayload(cleaned)
  if (normalizedPayload) {
    const encoded = encodeURIComponent(normalizedPayload)
    for (const root of roots) {
      candidates.push(`${root}#${encoded}`)
    }
  }

  for (const url of candidates) {
    const tryParse = (candidate: string): Invite | null => {
      try {
        const payload = parseInvitePayload(candidate)
        if (payload?.purpose && payload.purpose !== "link") return null
        if (payload?.owner && payload.owner !== ownerPubkey) return null
        return Invite.fromUrl(candidate)
      } catch {
        return null
      }
    }

    const invite = tryParse(url)
    if (invite) return invite

    const normalizedPayload = normalizeInvitePayloadFromUrl(url)
    if (normalizedPayload) {
      try {
        const normalizedUrl = new URL(url)
        normalizedUrl.hash = encodeURIComponent(normalizedPayload)
        const normalizedInvite = tryParse(normalizedUrl.toString())
        if (normalizedInvite) return normalizedInvite
      } catch {
        // ignore normalization failure
      }
    }
  }

  return null
}
