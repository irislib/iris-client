import MinidenticonImg from "../user/MinidenticonImg"
import {NostrEvent} from "nostr-tools"
import {useNavigate} from "react-router"
import ProxyImg from "../ProxyImg"

type ChannelCreationProps = {
  event: NostrEvent
}

const ChannelCreation = ({event}: ChannelCreationProps) => {
  const navigate = useNavigate()

  try {
    const metadata = JSON.parse(event.content)
    const channelId = event.id

    const handleViewChannel = () => {
      navigate(`/chats/${channelId}`)
    }

    return (
      <div className="card bg-base-200 shadow-md">
        <div className="card-body p-4 flex flex-col h-full">
          <div className="flex-1">
            <div className="flex items-center gap-3 mb-2">
              {metadata?.picture ? (
                <ProxyImg
                  src={metadata.picture}
                  alt={metadata.name}
                  className="w-10 h-10 rounded-full object-cover"
                  square={true}
                />
              ) : (
                <MinidenticonImg
                  username={channelId}
                  className="w-10 h-10 rounded-full"
                />
              )}
              <div>
                <h3 className="font-semibold">
                  {metadata?.name || `Channel ${channelId.slice(0, 8)}...`}
                </h3>
                <p className="text-xs text-base-content/70">New channel created</p>
              </div>
            </div>
            {metadata?.about && (
              <p className="text-sm text-base-content/80 mb-3 line-clamp-2">
                {metadata.about}
              </p>
            )}
          </div>
          <button
            className="btn btn-sm btn-primary w-full mt-auto"
            onClick={handleViewChannel}
          >
            View Channel
          </button>
        </div>
      </div>
    )
  } catch (e) {
    console.error("Failed to parse channel creation content:", e)
    return null
  }
}

export default ChannelCreation
