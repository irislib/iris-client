import animals from "./data/animals.json"
import adjectives from "./data/adjectives.json"

function capitalize(s: string) {
  if (typeof s !== "string") return ""
  return s.charAt(0).toUpperCase() + s.slice(1)
}

// Deterministic hash function for pubkey
function hashCode(str: string): number {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash // Convert to 32bit integer
  }
  return Math.abs(hash)
}

export default function getAnimalName(seed: string): string {
  if (!seed) {
    throw new Error("No seed provided")
  }
  const hash = hashCode(seed)
  const adjIndex = hash % adjectives.length
  const animalIndex = Math.floor(hash / adjectives.length) % animals.length

  return `${capitalize(adjectives[adjIndex])} ${capitalize(animals[animalIndex])}`
}

export function getDisplayName(pubkey: string, customName: string | null): string {
  if (customName && customName.trim()) {
    return customName.trim()
  }
  return getAnimalName(pubkey)
}
