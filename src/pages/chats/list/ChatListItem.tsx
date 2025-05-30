import {ConnectionStatus} from "@/shared/components/connection/ConnectionStatus"
import {fetchChannelMetadata, ChannelMetadata} from "../utils/channelMetadata"
import RelativeTime from "@/shared/components/event/RelativeTime"
import {getMillisecondTimestamp} from "nostr-double-ratchet/src"
import {PublicChatContext} from "../public/PublicChatContext"
import {useLocalState} from "irisdb-hooks/src/useLocalState"
import {Avatar} from "@/shared/components/user/Avatar"
import {useEffect, useState, useContext} from "react"
import ProxyImg from "@/shared/components/ProxyImg"
import {shouldHideAuthor} from "@/utils/visibility"
import {Name} from "@/shared/components/user/Name"
import {CHANNEL_MESSAGE} from "../utils/constants"
import {useSessionsStore} from "@/stores/sessions"
import {useLocation, NavLink} from "react-router"
import {MessageType} from "../message/Message"
import {useEventsStore} from "@/stores/events"
import {RiEarthLine} from "@remixicon/react"
import debounce from "lodash/debounce"
import classNames from "classnames"
import {ndk} from "@/utils/ndk"

interface ChatListItemProps {
  id: string
  isPublic?: boolean
}

const ChatListItem = ({id, isPublic = false}: ChatListItemProps) => {
  const location = useLocation()
  const pubKey = isPublic ? "" : id.split(":").shift() || ""
  const isActive = location.state?.id === id
  const [latestMessage, setLatestMessage] = useState<{
    content: string
    created_at: number
  } | null>(null)
  const {setPublicChatTimestamps} = useContext(PublicChatContext)
  const [showPlaceholder, setShowPlaceholder] = useState(false)
  const [channelMetadata, setChannelMetadata] = useState<ChannelMetadata | null>(null)
  const [isLoadingMetadata, setIsLoadingMetadata] = useState(false)
  const {events} = useEventsStore()
  const {lastSeen} = useSessionsStore()

  // Fetch channel metadata for public chats
  useEffect(() => {
    if (!isPublic) return

    const fetchMetadata = async () => {
      setIsLoadingMetadata(true)
      try {
        const metadata = await fetchChannelMetadata(id)
        setChannelMetadata(metadata)
      } catch (err) {
        console.error("Error fetching channel metadata:", err)
      } finally {
        setIsLoadingMetadata(false)
      }
    }

    fetchMetadata()
  }, [id, isPublic])

  const [_latestId, latest] = events.get(id)?.last() ?? []
  const [lastSeenPublicTime, setLastSeenPublicTime] = useLocalState(
    `sessions/${id}/lastSeen`,
    0
  )
  const lastSeenPrivateTime = lastSeen.get(id) || 0
  const [deleted] = useLocalState(`sessions/${id}/deleted`, false)

  // Fetch latest message for public chats
  useEffect(() => {
    if (!isPublic) return

    let latestMessageInMemory: {content: string; created_at: number} | null = null

    const debouncedUpdate = debounce(() => {
      if (latestMessageInMemory) {
        setLatestMessage(latestMessageInMemory)
        if (setPublicChatTimestamps) {
          setPublicChatTimestamps((prev) => ({
            ...prev,
            [id]: latestMessageInMemory!.created_at,
          }))
        }
      }
    }, 300)

    // Set up subscription for latest messages
    const sub = ndk().subscribe({
      kinds: [CHANNEL_MESSAGE],
      "#e": [id],
      limit: 1,
    })

    // Handle new messages
    sub.on("event", (event) => {
      if (!event || !event.id) return
      if (shouldHideAuthor(event.pubkey)) return

      // Always update the in-memory latest message
      if (!latestMessageInMemory || event.created_at > latestMessageInMemory.created_at) {
        latestMessageInMemory = {
          content: event.content,
          created_at: event.created_at,
        }
        debouncedUpdate()
      }
    })

    // Clean up subscription when component unmounts
    return () => {
      sub.stop()
      debouncedUpdate.cancel()
    }
  }, [id, isPublic, setPublicChatTimestamps])

  useEffect(() => {
    // Set a timeout to show the placeholder after 2 seconds if metadata hasn't loaded
    const timer = setTimeout(() => {
      if (!channelMetadata && !isLoadingMetadata) {
        setShowPlaceholder(true)
      }
    }, 2000)

    return () => clearTimeout(timer)
  }, [channelMetadata, isLoadingMetadata])

  const getPreviewText = () => {
    if (isPublic && latestMessage?.content) {
      const content = latestMessage.content
      return content.length > 30 ? content.slice(0, 30) + "..." : content
    }

    if (latest?.content) {
      const content = latest.content
      return content.length > 30 ? content.slice(0, 30) + "..." : content
    }

    return ""
  }

  const previewText = getPreviewText()

  if (deleted && !isPublic) return null

  return (
    <NavLink
      to={isPublic ? `/chats/${id}` : "/chats/chat"}
      state={{id}}
      key={id}
      onClick={() => isPublic && setLastSeenPublicTime(Date.now())}
      className={classNames("px-2 py-4 flex items-center border-b border-custom", {
        "bg-base-300": isActive,
        "hover:bg-base-300": !isActive,
      })}
    >
      <div className="flex flex-row items-center gap-2 flex-1">
        {isPublic &&
          (channelMetadata?.picture ? (
            <ProxyImg
              width={18}
              square={true}
              src={channelMetadata.picture}
              alt="Channel Icon"
              className="rounded-full w-10 h-10"
            />
          ) : (
            <div className="w-10 h-10 rounded-full bg-base-300 flex items-center justify-center">
              <span className="text-lg">#</span>
            </div>
          ))}
        {!isPublic && <Avatar pubKey={pubKey} />}
        <div className="flex flex-col flex-1">
          <div className="flex flex-row items-center justify-between gap-2">
            <span className="text-base font-semibold flex items-center gap-1">
              {isPublic && <RiEarthLine className="w-4 h-4" />}
              {isPublic ? (
                channelMetadata?.name ||
                (showPlaceholder ? `Channel ${id.slice(0, 8)}...` : "")
              ) : (
                <Name pubKey={pubKey} />
              )}
            </span>
            <div className="flex flex-col gap-2">
              {(isPublic ? latestMessage?.created_at : latest?.created_at) && (
                <span className="text-sm text-base-content/70 ml-2">
                  <RelativeTime
                    from={
                      isPublic && latestMessage?.created_at
                        ? latestMessage.created_at * 1000
                        : getMillisecondTimestamp(latest as MessageType) // TODO: we know it's not undefined, TS doesn't -> do this without type assertion
                    }
                  />
                </span>
              )}
              {!isPublic && <ConnectionStatus peerId={id} />}
            </div>
          </div>
          <div className="flex flex-row items-center justify-between gap-2">
            <span className="text-sm text-base-content/70 min-h-[1.25rem]">
              {previewText}
            </span>
            {(() => {
              if (isPublic) {
                if (!latestMessage?.created_at) return null
                const hasUnread = latestMessage.created_at * 1000 > lastSeenPublicTime
                return (
                  (!lastSeenPublicTime || hasUnread) && (
                    <div className="indicator-item badge badge-primary badge-xs"></div>
                  )
                )
              } else {
                if (!latest?.created_at) return null
                const hasUnread = getMillisecondTimestamp(latest) > lastSeenPrivateTime
                return (
                  (!lastSeenPrivateTime || hasUnread) && (
                    <div className="indicator-item badge badge-primary badge-xs"></div>
                  )
                )
              }
            })()}
          </div>
        </div>
      </div>
    </NavLink>
  )
}

export default ChatListItem
