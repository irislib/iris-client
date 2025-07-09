import {ConnectionStatus} from "@/shared/components/connection/ConnectionStatus"
import RelativeTime from "@/shared/components/event/RelativeTime"
import {getMillisecondTimestamp} from "nostr-double-ratchet/src"
import {usePublicChatsStore} from "@/stores/publicChats"
import {Avatar} from "@/shared/components/user/Avatar"
import ProxyImg from "@/shared/components/ProxyImg"
import {shouldHideAuthor} from "@/utils/visibility"
import {Name} from "@/shared/components/user/Name"
import {CHANNEL_MESSAGE} from "../utils/constants"
import {useSessionsStore} from "@/stores/sessions"
import {useLocation, NavLink} from "react-router"
import {MessageType} from "../message/Message"
import {useEventsStore} from "@/stores/events"
import {RiEarthLine} from "@remixicon/react"
import {useUserStore} from "@/stores/user"
import {useEffect, useState} from "react"
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
    pubkey: string
  } | null>(null)
  const [showPlaceholder, setShowPlaceholder] = useState(false)
  const {events} = useEventsStore()
  const {lastSeen} = useSessionsStore()
  const {
    publicChats,
    lastSeen: lastSeenPublic,
    updateLastSeen: updateLastSeenPublic,
    updateTimestamp,
  } = usePublicChatsStore()
  const myPubKey = useUserStore((state) => state.publicKey)

  const chat = isPublic ? publicChats[id] : null

  const [, latest] = events.get(id)?.last() ?? []
  const lastSeenPrivateTime = lastSeen.get(id) || 0
  const lastSeenPublicTime = lastSeenPublic[id] || 0

  useEffect(() => {
    if (!isPublic) return

    let latestMessageInMemory: {
      content: string
      created_at: number
      pubkey: string
    } | null = null

    const debouncedUpdate = debounce(() => {
      if (latestMessageInMemory) {
        setLatestMessage(latestMessageInMemory)
        updateTimestamp(id, latestMessageInMemory.created_at)
      }
    }, 300)

    const sub = ndk().subscribe({
      kinds: [CHANNEL_MESSAGE],
      "#e": [id],
      limit: 1,
    })

    sub.on("event", (event) => {
      if (!event || !event.id) return
      if (shouldHideAuthor(event.pubkey)) return
      if (!latestMessageInMemory || event.created_at > latestMessageInMemory.created_at) {
        latestMessageInMemory = {
          content: event.content,
          created_at: event.created_at,
          pubkey: event.pubkey,
        }
        debouncedUpdate()
      }
    })

    return () => {
      sub.stop()
      debouncedUpdate.cancel()
    }
  }, [id, isPublic, updateTimestamp])

  useEffect(() => {
    const timer = setTimeout(() => {
      if (!chat) {
        setShowPlaceholder(true)
      }
    }, 2000)

    return () => clearTimeout(timer)
  }, [chat])

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

  return (
    <NavLink
      to={isPublic ? `/chats/${id}` : "/chats/chat"}
      state={{id}}
      key={id}
      onClick={() => isPublic && updateLastSeenPublic(id)}
      className={classNames("px-2 py-4 flex items-center border-b border-custom", {
        "bg-base-300": isActive,
        "hover:bg-base-300": !isActive,
      })}
    >
      <div className="flex flex-row items-center gap-2 flex-1">
        {isPublic &&
          (chat?.picture ? (
            <ProxyImg
              width={18}
              square={true}
              src={chat.picture}
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
                chat?.name || (showPlaceholder ? `Channel ${id.slice(0, 8)}...` : "")
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
                if (latestMessage.pubkey === myPubKey) return null
                const hasUnread = latestMessage.created_at * 1000 > lastSeenPublicTime
                return (
                  (!lastSeenPublicTime || hasUnread) && (
                    <div className="indicator-item badge badge-primary badge-xs" />
                  )
                )
              } else {
                if (!latest?.created_at) return null
                if (latest.sender === "user") return null
                const hasUnread = getMillisecondTimestamp(latest) > lastSeenPrivateTime
                return (
                  (!lastSeenPrivateTime || hasUnread) && (
                    <div className="indicator-item badge badge-primary badge-xs" />
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
