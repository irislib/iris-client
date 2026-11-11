import {updateChannelSearchIndex, getCachedChannel} from "./channelSearch"
import {shouldHideUser} from "@/utils/visibility"
import {fetchEventReliable} from "@/utils/fetchEventsReliable"
import {nostr} from "@/utils/nostrClient"
import type {AppEvent} from "@/lib/nostr"

// NIP-28 event kinds
export const CHANNEL_CREATE = 40

export type ChannelMetadata = {
  id: string
  name: string
  about: string
  picture: string
  relays: string[]
  founderPubkey: string
  createdAt: number
}

let channelIndexStarted = false

/**
 * Index recent channel creations for search as each one arrives, so matches show up
 * without any relay having to finish answering first.
 */
export const indexRecentChannels = () => {
  if (channelIndexStarted) return
  channelIndexStarted = true
  const sub = nostr().subscribe({kinds: [CHANNEL_CREATE], limit: 100})
  sub.on("event", (event: AppEvent) => {
    if (shouldHideUser(event.pubkey)) return
    try {
      updateChannelSearchIndex(event.id, {
        id: event.id,
        ...JSON.parse(event.content),
        founderPubkey: event.pubkey,
        createdAt: event.created_at,
      })
    } catch (e) {
      console.error("Failed to parse channel creation content:", e)
    }
  })
}

/**
 * Fetches channel metadata for a given channel ID
 * @param channelId The ID of the channel to fetch metadata for
 * @returns A promise that resolves to the channel metadata or null if not found
 */
export const fetchChannelMetadata = async (
  channelId: string
): Promise<ChannelMetadata | null> => {
  // Check cache first
  const cached = getCachedChannel(channelId)
  if (cached) {
    return cached
  }

  try {
    // First try to fetch the channel creation event
    const {promise} = fetchEventReliable(
      {kinds: [CHANNEL_CREATE], ids: [channelId]},
      {timeout: 5000}
    )
    const channelEvent = await promise

    if (channelEvent) {
      try {
        const metadata = JSON.parse(channelEvent.content)
        const channelMetadata = {
          id: channelEvent.id,
          ...metadata,
          founderPubkey: channelEvent.pubkey,
          createdAt: channelEvent.created_at,
        }
        // Update search index
        updateChannelSearchIndex(channelId, channelMetadata)
        return channelMetadata
      } catch (e) {
        console.error("Failed to parse channel creation content:", e)
      }
    } else {
      // If no channel creation event found, try to fetch the channel message event
      // This is a fallback approach since some channels might not have a creation event
      const {promise: msgPromise} = fetchEventReliable(
        {kinds: [42], ids: [channelId]},
        {timeout: 5000}
      )
      const channelMessageEvent = await msgPromise

      if (channelMessageEvent) {
        // Create a basic metadata object from the message event
        const channelMetadata = {
          id: channelMessageEvent.id,
          name: `Channel ${channelId.substring(0, 8)}...`,
          about: "Channel information not available",
          picture: "",
          relays: [],
          founderPubkey: channelMessageEvent.pubkey,
          createdAt: channelMessageEvent.created_at || Math.floor(Date.now() / 1000),
        }
        // Update search index
        updateChannelSearchIndex(channelId, channelMetadata)
        return channelMetadata
      }
    }
  } catch (err) {
    console.error("Error fetching channel metadata:", err)
  }

  return null
}
