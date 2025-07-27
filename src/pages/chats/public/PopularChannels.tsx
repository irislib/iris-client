import PopularChannelItem from "./PopularChannelItem"
import {CHANNEL_MESSAGE} from "../utils/constants"
import socialGraph from "@/utils/socialGraph"
import {useState, useEffect} from "react"

type PopularChannel = {
  id: string
  name: string
  about: string
  picture: string
  authorCount: number
}

type PopularChannelsProps = {
  publicKey: string
}

const PopularChannels = ({publicKey}: PopularChannelsProps) => {
  const [popularChannels, setPopularChannels] = useState<PopularChannel[]>([])
  // Remove error state
  // const [error, setError] = useState<string | null>(null)

  // Fetch popular channels from followed users
  useEffect(() => {
    if (!publicKey) return

    const fetchPopularChannels = async () => {
      // Remove setError(null)
      console.log("Fetching popular channels for publicKey:", publicKey)
      // Get followed users using social graph
      const followedUsers = await socialGraph().getUsersByFollowDistance(1)
      console.log("Followed users count:", followedUsers.size)
      if (followedUsers.size === 0) {
        console.log("No followed users found")
        return
      }

      // Fetch channel messages from followed users
      console.log("Fetching channel messages from followed users")
      // Use applesauce fetchEvents for this logic
      const {fetchEvents} = await import("@/utils/applesauce")
      const channelMessages = await fetchEvents({
        kinds: [CHANNEL_MESSAGE],
        authors: Array.from(followedUsers),
      })
      console.log("Channel messages count:", channelMessages.length)

      // Process messages to identify channels and count unique authors
      const channelMap = new Map<string, {authors: Set<string>}>()

      for (const event of Array.from(channelMessages)) {
        // Extract channel ID from the 'e' tag
        const channelIdTag = event.tags.find((tag: string[]) => tag[0] === "e")
        if (!channelIdTag) continue

        const channelId = channelIdTag[1]

        if (!channelMap.has(channelId)) {
          channelMap.set(channelId, {authors: new Set()})
        }

        const channelData = channelMap.get(channelId)!
        channelData.authors.add(event.pubkey)
      }

      console.log("Unique channels found:", channelMap.size)

      // Convert to array and sort by author count
      const channels: PopularChannel[] = []

      for (const [id, data] of channelMap.entries()) {
        channels.push({
          id,
          name: "", // Will be fetched by PopularChannelItem
          about: "", // Will be fetched by PopularChannelItem
          picture: "", // Will be fetched by PopularChannelItem
          authorCount: data.authors.size,
        })
      }

      // Sort by author count (descending)
      channels.sort((a, b) => b.authorCount - a.authorCount)

      console.log("Channels to display:", channels.length)
      // Create a new array to ensure React detects the state change
      setPopularChannels([...channels])
    }

    fetchPopularChannels()
  }, [publicKey])

  if (popularChannels.length === 0) {
    return null
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {popularChannels.map((channel) => (
        <PopularChannelItem
          key={channel.id}
          channelId={channel.id}
          authorCount={channel.authorCount}
        />
      ))}
    </div>
  )
}

export default PopularChannels
