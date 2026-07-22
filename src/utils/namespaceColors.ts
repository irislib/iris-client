/**
 * Color palette for debug namespaces
 * Uses a deterministic hash-based color assignment
 */

const NAMESPACE_COLORS = [
  "bg-blue-100 text-blue-900",
  "bg-purple-100 text-purple-900",
  "bg-pink-100 text-pink-900",
  "bg-red-100 text-red-900",
  "bg-orange-100 text-orange-900",
  "bg-yellow-100 text-yellow-900",
  "bg-green-100 text-green-900",
  "bg-teal-100 text-teal-900",
  "bg-cyan-100 text-cyan-900",
  "bg-indigo-100 text-indigo-900",
]

// Vibrant peer/session colors (similar to old WebRTC logger)
const PEER_COLORS = [
  "bg-red-200 text-red-900",
  "bg-cyan-200 text-cyan-900",
  "bg-blue-200 text-blue-900",
  "bg-emerald-200 text-emerald-900",
  "bg-amber-200 text-amber-900",
  "bg-zinc-300 text-zinc-900",
  "bg-violet-200 text-violet-900",
  "bg-pink-200 text-pink-900",
]

const colorCache = new Map<string, string>()

/**
 * Simple hash function for consistent color assignment
 */
function hashString(str: string): number {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = (hash << 5) - hash + char
    hash = hash & hash // Convert to 32bit integer
  }
  return Math.abs(hash)
}

/**
 * Get a consistent color for a namespace
 */
export function getNamespaceColor(namespace: string): string {
  if (colorCache.has(namespace)) {
    return colorCache.get(namespace)!
  }

  // Use root namespace (e.g., "ndk" from "ndk:relay:conn")
  const rootNamespace = namespace.split(":")[0]
  const hash = hashString(rootNamespace)
  const color = NAMESPACE_COLORS[hash % NAMESPACE_COLORS.length]

  colorCache.set(namespace, color)
  return color
}

/**
 * Extract peer/session ID from log message and get its color
 * Looks for patterns like "sessionId:xxx" or "peerId:xxx"
 */
export function extractAndColorPeerId(message: string): {
  text: string
  peerId?: string
  color?: string
} {
  // Look for session ID or peer ID patterns (UUID format)
  const sessionMatch = message.match(/sessionId[:\s]+([a-f0-9]{8})/i)
  const peerMatch = message.match(/peerId[:\s]+([a-f0-9]{8})/i)
  const uuidMatch = message.match(/([a-f0-9]{6}-[a-f0-9]{4})/i)

  if (sessionMatch) {
    const sessionId = sessionMatch[1]
    const hash = hashString(sessionId)
    const color = PEER_COLORS[hash % PEER_COLORS.length]
    return {text: `session:${sessionId}`, peerId: sessionId, color}
  }

  if (peerMatch) {
    const peerId = peerMatch[1]
    const hash = hashString(peerId)
    const color = PEER_COLORS[hash % PEER_COLORS.length]
    return {text: `peer:${peerId}`, peerId, color}
  }

  if (uuidMatch) {
    const uuid = uuidMatch[1]
    const hash = hashString(uuid)
    const color = PEER_COLORS[hash % PEER_COLORS.length]
    return {text: uuid, peerId: uuid, color}
  }

  return {text: ""}
}
