import {ChannelMetadata, indexRecentChannels} from "../utils/channelMetadata"
import MinidenticonImg from "@/shared/components/user/MinidenticonImg"
import {searchChannels} from "../utils/channelSearch"
import {useState, useEffect} from "react"
import ProxyImg from "@/shared/components/ProxyImg"
import Icon from "@/shared/components/Icons/Icon"
import PopularChannels from "./PopularChannels"
import {useUserStore} from "@/stores/user"
import {useNavigate} from "@/navigation"

let publicKey = useUserStore.getState().publicKey
useUserStore.subscribe((state) => {
  publicKey = state.publicKey
})

const PublicChatCreation = () => {
  const navigate = useNavigate()
  const [searchInput, setSearchInput] = useState("")
  const [matchingChannels, setMatchingChannels] = useState<ChannelMetadata[]>([])

  useEffect(indexRecentChannels, [])

  const onSearchChange = async (value: string) => {
    setSearchInput(value)
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
      const results = searchChannels(value)
      setMatchingChannels(results.slice(0, 5))
    } catch (err) {
      setMatchingChannels([])
    }
  }

  return (
    <div className="m-4 p-4 md:p-8 rounded-lg bg-base-100 flex flex-col gap-8">
      <p className="text-base-content/70">
        Public channels are open chat rooms where anyone can join and participate in
        conversations. Messages are not encrypted and are visible to everyone.
      </p>
      <div className="flex flex-col">
        <button
          className="btn btn-neutral"
          onClick={() => navigate("/chats/new/public/create")}
        >
          <Icon name="plus" className="w-4 h-4 mr-2" />
          Create a Public Channel
        </button>
      </div>
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
                  <MinidenticonImg
                    username={metadata.id}
                    className="w-10 h-10 rounded-full"
                  />
                )}
                <div className="flex flex-col break-words [overflow-wrap:anywhere]">
                  <span className="font-medium line-clamp-1">{metadata.name}</span>
                  {metadata.about && (
                    <span className="text-sm opacity-70 line-clamp-2">
                      {metadata.about}
                    </span>
                  )}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
      {searchInput.trim() === "" && <PopularChannels publicKey={publicKey} />}
    </div>
  )
}

export default PublicChatCreation
