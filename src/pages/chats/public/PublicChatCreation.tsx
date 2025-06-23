import {NDKEvent} from "@nostr-dev-kit/ndk"
import {useState, FormEvent, useEffect} from "react"
import {useNavigate} from "react-router"
import {ndk} from "@/utils/ndk"
import PopularChannels from "./PopularChannels"
import {useUserStore} from "@/stores/user"
import ProxyImg from "@/shared/components/ProxyImg"
import MinidenticonImg from "@/shared/components/user/MinidenticonImg"
import { searchChannels } from "../utils/channelSearch"
import { ChannelMetadata, getChannelsByFollowed } from "../utils/channelMetadata"

let publicKey = useUserStore.getState().publicKey
useUserStore.subscribe((state) => {
  publicKey = state.publicKey
})

const PublicChatCreation = () => {
  const navigate = useNavigate()
  const [channelName, setChannelName] = useState("")
  const [channelAbout, setChannelAbout] = useState("")
  const [channelPicture, setChannelPicture] = useState("")
  const [searchInput, setSearchInput] = useState("")
  const [matchingChannels, setMatchingChannels] = useState<ChannelMetadata[]>([])
  const [createError, setCreateError] = useState<string | null>(null)

  // Fetch channels by followed users on mount
  useEffect(() => {
    getChannelsByFollowed().catch(console.error)
  }, [])

  const onSearchChange = async (value: string) => {
    setSearchInput(value)

    console.log("Searching for channels with term:", value)

    if (!value.trim()) {
      setMatchingChannels([])
      return
    }

    // Check if input is a valid channel ID
    if (/^[a-f0-9]{64}$/.test(value)) {
      setMatchingChannels([])
      navigate(`/chats/${value}`)
      return
    }

    try {
      console.log("Searching channels with term:", value)
      // Use our local search index
      const results = searchChannels(value)
      console.log("Found channels:", results)
      setMatchingChannels(results.slice(0, 5))
    } catch (err) {
      console.error("Error searching channels:", err)
      setMatchingChannels([])
    }
  }

  const handleCreateChannel = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()

    if (!channelName.trim()) {
      setCreateError("Channel name is required")
      return
    }

    try {
      setCreateError(null)

      if (!publicKey) {
        setCreateError("You need to be logged in to create a channel")
        return
      }

      // Create channel metadata
      const metadata = {
        name: channelName,
        about: channelAbout,
        picture: channelPicture,
        relays: [], // Default relays will be used
      }

      // Create channel creation event (kind 40)
      const event = new NDKEvent(ndk())
      event.kind = 40 // CHANNEL_CREATE
      event.content = JSON.stringify(metadata)
      await event.publish()

      // Navigate to the new channel
      navigate(`/chats/${event.id}`)
    } catch (err) {
      console.error("Error creating channel:", err)
      setCreateError("Failed to create channel")
    }
  }

  return (
    <div className="m-4 p-4 md:p-8 rounded-lg bg-base-100 flex flex-col gap-6">
      <div>
        <h2 className="text-xl font-semibold mb-4">Join a Public Channel</h2>
        <div className="flex flex-col gap-4">
          <div>
            <input
              type="text"
              className="input input-bordered w-full"
              placeholder="Search term or channel ID"
              value={searchInput}
              onChange={(e) => onSearchChange(e.target.value)}
              required
            />
          </div>
        </div>
        {matchingChannels.length > 0 && (
          <div className="mt-4 flex flex-col gap-2">
            {matchingChannels.map((metadata) => (
              <button
                key={metadata.id}
                className="btn btn-ghost justify-start text-left"
                onClick={() => navigate(`/chats/${metadata.id}`)}
              >
                <div className="flex items-center gap-3">
                  {metadata.picture ? (
                    <ProxyImg
                      src={metadata.picture}
                      alt={metadata.name}
                      className="w-10 h-10 rounded-full object-cover"
                      square={true}
                    />
                  ) : (
                    <MinidenticonImg username={metadata.id} className="w-10 h-10 rounded-full" />
                  )}
                  <div className="flex flex-col break-words [overflow-wrap:anywhere]">
                    <span className="font-medium line-clamp-1">{metadata.name}</span>
                    {metadata.about && <span className="text-sm opacity-70 line-clamp-2">{metadata.about}</span>}
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="divider">OR</div>

      <div>
        <h2 className="text-xl font-semibold mb-4">Create a Public Channel</h2>
        <form onSubmit={handleCreateChannel} className="flex flex-col gap-4">
          <div>
            <label className="label">
              <span className="label-text">Channel Name</span>
            </label>
            <input
              type="text"
              className="input input-bordered w-full"
              placeholder="Enter channel name"
              value={channelName}
              onChange={(e) => setChannelName(e.target.value)}
              required
            />
          </div>
          <div>
            <label className="label">
              <span className="label-text">Description (optional)</span>
            </label>
            <textarea
              className="textarea textarea-bordered w-full"
              placeholder="Enter channel description"
              value={channelAbout}
              onChange={(e) => setChannelAbout(e.target.value)}
            />
          </div>
          <div>
            <label className="label">
              <span className="label-text">Picture URL (optional)</span>
            </label>
            <input
              type="text"
              className="input input-bordered w-full"
              placeholder="Enter picture URL"
              value={channelPicture}
              onChange={(e) => setChannelPicture(e.target.value)}
            />
          </div>
          {createError && <div className="text-error">{createError}</div>}
          <button type="submit" className="btn btn-primary">
            Create Channel
          </button>
        </form>
      </div>

      <div className="divider">OR</div>

      <PopularChannels publicKey={publicKey} />

      <div className="mt-4">
        <h3 className="text-lg font-semibold mb-2">About Public Channels</h3>
        <p className="text-base-content/70">
          Public channels are open chat rooms where anyone can join and participate in
          conversations. Messages are not encrypted and are visible to everyone.
        </p>
      </div>
    </div>
  )
}

export default PublicChatCreation
