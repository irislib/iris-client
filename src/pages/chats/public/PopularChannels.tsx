import PopularChannelItem from "./PopularChannelItem"
import {KIND_CHANNEL_MESSAGE, DEBUG_NAMESPACES} from "@/utils/constants"
import {useSocialGraph} from "@/utils/socialGraph"
import {useState, useEffect} from "react"
import {createDebugLogger} from "@/utils/createDebugLogger"
import {nostr} from "@/utils/nostrClient"
import type {AppEvent} from "@/lib/nostr"

const {log} = createDebugLogger(DEBUG_NAMESPACES.UI_CHAT)

type PopularChannel = {
  id: string
  authorCount: number
}

/** Coalesce bursts of arriving messages into one list update. */
const POPULAR_CHANNELS_RENDER_MS = 100

type PopularChannelsProps = {
  publicKey: string
}

const PopularChannels = ({publicKey}: PopularChannelsProps) => {
  const socialGraph = useSocialGraph()
  const [popularChannels, setPopularChannels] = useState<PopularChannel[]>([])
  // Rank channels by how many followed users post in them, updating as messages arrive.
  useEffect(() => {
    if (!publicKey) return
    const followedUsers = socialGraph.getUsersByFollowDistance(1)
    log("Followed users count:", followedUsers.size)
    if (followedUsers.size === 0) return
    let renderTimer: ReturnType<typeof setTimeout> | undefined
    const authorsByChannel = new Map<string, Set<string>>()
    const render = () => {
      renderTimer = undefined
      setPopularChannels(
        [...authorsByChannel]
          .map(([id, authors]) => ({id, authorCount: authors.size}))
          .sort((a, b) => b.authorCount - a.authorCount)
      )
    }
    const sub = nostr().subscribe({
      kinds: [KIND_CHANNEL_MESSAGE],
      authors: Array.from(followedUsers),
      limit: 200,
    })
    sub.on("event", (event: AppEvent) => {
      const channelId = event.tags.find((tag) => tag[0] === "e")?.[1]
      if (!channelId) return
      const authors = authorsByChannel.get(channelId) ?? new Set<string>()
      authorsByChannel.set(channelId, authors.add(event.pubkey))
      renderTimer ??= setTimeout(render, POPULAR_CHANNELS_RENDER_MS)
    })

    return () => {
      clearTimeout(renderTimer)
      sub.stop()
    }
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
