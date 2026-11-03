import type {Event} from "nostr-tools"

// URL canonicalizes integer, hexadecimal and abbreviated IPv4 literals before this check.
function isPublicRelayHost(host: string): boolean {
  if (host.startsWith("[")) {
    // Native global unicast only. Mapped IPv4, ULA, link-local and multicast fall outside
    // 2000::/3. Also exclude protocol assignments (including Teredo) and 6to4 tunnels.
    const [prefix, subnet] = host.slice(1, -1).split(":")
    const first = parseInt(prefix, 16)
    const second = parseInt(subnet || "0", 16)
    return (
      first >= 0x2000 &&
      first < 0x4000 &&
      first !== 0x2002 &&
      !(first === 0x2001 && (second < 0x200 || second === 0xdb8)) &&
      !(first === 0x3fff && second < 0x1000)
    )
  }
  const hostname = host.replace(/\.+$/, "")
  if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname)) {
    const [a, b, c] = hostname.split(".").map(Number)
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0 && (c === 0 || c === 2)) ||
      (a === 192 && b === 88 && c === 99) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
      (a === 203 && b === 0 && c === 113)
    )
  }
  return (
    /^(?:[a-z0-9-]+\.)+[a-z0-9-]+$/.test(hostname) &&
    !/(?:^|\.)(?:localhost|local|localdomain|lan|internal|home|corp|intranet|arpa)$/.test(
      hostname
    )
  )
}

export function isPublicRelayUrl(url: URL): boolean {
  return url.protocol === "wss:" && isPublicRelayHost(url.hostname)
}

export function normalizedRelayUrls(
  values: Iterable<string>,
  limit: number,
  accept?: (url: URL) => boolean
): string[] {
  const urls = new Set<string>()
  for (const value of values) {
    try {
      const url = new URL(value)
      if (
        !["wss:", "ws:"].includes(url.protocol) ||
        url.username ||
        url.password ||
        url.href.includes("#") ||
        (accept && !accept(url))
      )
        continue
      urls.add(url.href.replace(/\/$/, ""))
      if (urls.size >= limit) break
    } catch {
      // Ignore malformed relay metadata.
    }
  }
  return [...urls]
}

export function relayHintsFromUrls(values: Iterable<string>, limit = 6): string[] {
  return normalizedRelayUrls(values, limit, isPublicRelayUrl)
}

/** NIP-65 relay hints are bounded and never override an explicitly scoped operation. */
export function relayHints(
  events: Iterable<Event>,
  role: "read" | "write",
  limit = 6
): string[] {
  const newest = new Map<string, Event>()
  for (const event of events) {
    if (event.kind !== 10002) continue
    const previous = newest.get(event.pubkey)
    if (!previous || event.created_at > previous.created_at)
      newest.set(event.pubkey, event)
  }
  function* advertisedUrls() {
    for (const event of newest.values())
      for (const [name, url, marker] of event.tags)
        if (name === "r" && url && (!marker || marker === role)) yield url
  }
  return relayHintsFromUrls(advertisedUrls(), limit)
}
