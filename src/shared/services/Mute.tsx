import {NDKEvent} from "@/lib/ndk"
import {getSocialGraph, handleSocialGraphEvent} from "@/utils/socialGraph"
import {NostrEvent} from "nostr-social-graph"
import {ndk} from "@/utils/ndk"
import {KIND_MUTE_LIST, KIND_FLAG_LIST} from "@/utils/constants"
import {clearVisibilityCache} from "@/utils/visibility"

export const muteUser = async (pubkey: string): Promise<string[]> => {
  const {mutedList} = validateInputAndGetMutedList(pubkey)

  // Check if pubkey already exists in the list before adding
  const newList = mutedList.has(pubkey) ? [...mutedList] : [...mutedList, pubkey]

  // Filter out any empty or invalid entries
  const validEntries = filterValidEntries(newList)
  return await updateMuteList(validEntries, mutedList)
}

export const unmuteUser = async (pubkey: string): Promise<string[]> => {
  const {mutedList} = validateInputAndGetMutedList(pubkey)

  const newList = Array.from(mutedList).filter(
    (entry: string) => entry !== pubkey && entry && entry.trim() !== ""
  )

  // Filter out any empty or invalid entries
  const validEntries = filterValidEntries(newList)
  return await updateMuteList(validEntries, mutedList)
}

const validateInputAndGetMutedList = (pubkey: string) => {
  // Validate input
  if (!pubkey || typeof pubkey !== "string" || pubkey.trim() === "") {
    throw new Error("Invalid pubkey: cannot be empty or whitespace")
  }

  const myKey = getSocialGraph().getRoot()
  if (!myKey || typeof myKey !== "string" || myKey.trim() === "") {
    throw new Error("Invalid user key: user not properly initialized")
  }

  const mutedList = getSocialGraph().getMutedByUser(myKey)
  return {mutedList, myKey}
}

const filterValidEntries = (entries: string[]): string[] => {
  return entries.filter(
    (entry) => entry && typeof entry === "string" && entry.trim() !== ""
  )
}

const updateMuteList = async (
  validEntries: string[],
  originalMutedList: Set<string>
): Promise<string[]> => {
  const newTags = validEntries.map((entry: string) => ["p", entry.trim()])

  const muteEvent = new NDKEvent(ndk())
  muteEvent.kind = KIND_MUTE_LIST
  muteEvent.tags = newTags

  await muteEvent.sign()

  handleSocialGraphEvent(muteEvent as NostrEvent)

  // Clear visibility cache so muted/unmuted users are immediately updated
  clearVisibilityCache()

  muteEvent.publish().catch((error) => {
    console.warn("Unable to update mute list", error)
    return Array.from(originalMutedList)
  })

  return validEntries
}

// Flagged users list (for reporting)
const flaggedUsers = new Set<string>()

export const flagUser = async (
  pubkey: string,
  reason: string,
  details?: string,
  eventId?: string
): Promise<void> => {
  if (!pubkey || typeof pubkey !== "string" || pubkey.trim() === "") {
    throw new Error("Invalid pubkey")
  }

  flaggedUsers.add(pubkey)

  const flagEvent = new NDKEvent(ndk())
  flagEvent.kind = KIND_FLAG_LIST
  flagEvent.content = JSON.stringify({
    reason,
    details,
    eventId,
  })
  flagEvent.tags = Array.from(flaggedUsers).map((entry: string) => ["p", entry.trim()])

  await flagEvent.sign()
  await flagEvent.publish()
}
