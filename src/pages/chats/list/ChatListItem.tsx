import {ConnectionStatus} from "@/shared/components/connection/ConnectionStatus"
import RelativeTime from "@/shared/components/event/RelativeTime"
import {getMillisecondTimestamp} from "nostr-double-ratchet/src"
import {usePublicChatsStore} from "@/stores/publicChats"
import {Avatar} from "@/shared/components/user/Avatar"
import ProxyImg from "@/shared/components/ProxyImg"
import {shouldHideAuthor} from "@/utils/visibility"
import {Name} from "@/shared/components/user/Name"
import {CHANNEL_MESSAGE, GROUP_INVITE_KIND} from "../utils/constants"
import {useSessionsStore} from "@/stores/sessions"
import {useLocation, NavLink} from "react-router"
import {MessageType} from "../message/Message"
import {useEventsStore} from "@/stores/events"
import {RiEarthLine} from "@remixicon/react"
import {useUserStore} from "@/stores/user"
import {useEffect, useState} from "react"
import debounce from "lodash/debounce"
import classNames from "classnames"
import {subscribe} from "@/utils/applesauce"
import {useGroupsStore} from "@/stores/groups"

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
    kind: number
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
  const {groups} = useGroupsStore()
  const group = groups[id]

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
      kind: number
    } | null = null

    const debouncedUpdate = debounce(() => {
      if (latestMessageInMemory) {
        setLatestMessage(latestMessageInMemory)
        updateTimestamp(id, latestMessageInMemory.created_at)
      }
    }, 300)

    const sub = subscribe({
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
          kind: event.kind,
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

  const getGroupInvitePreview = (pubkey: string, isCurrentUser: boolean) => {
    return (
      <span className="italic">
        {isCurrentUser ? (
          "You created the group"
        ) : (
          <>
            <Name pubKey={pubkey} /> added you to the group
          </>
        )}
      </span>
    )
  }

  const getPreviewContent = () => {
    if (isPublic && latestMessage?.content) {
      // Show special preview for group invite messages
      if (latestMessage.kind === GROUP_INVITE_KIND) {
        return getGroupInvitePreview(
          latestMessage.pubkey,
          latestMessage.pubkey === myPubKey
        )
      }
      const content = latestMessage.content
      return content.length > 30 ? content.slice(0, 30) + "..." : content
    }

    if (latest?.content) {
      // Show special preview for group invite messages
      if (latest.kind === GROUP_INVITE_KIND) {
        return getGroupInvitePreview(latest.pubkey, latest.pubkey === "user")
      }
      const content = latest.content
      return content.length > 30 ? content.slice(0, 30) + "..." : content
    }

    return ""
  }

  const previewContent = getPreviewContent()

  // Avatar rendering
  let avatar
  if (group) {
    if (group.picture) {
      avatar = (
        <ProxyImg
          width={18}
          square={true}
          src={group.picture}
          alt="Group Icon"
          className="rounded-full w-10 h-10"
        />
      )
    } else {
      avatar = (
        <div className="w-10 h-10 rounded-full bg-base-300 flex items-center justify-center">
          <span className="text-lg">👥</span>
        </div>
      )
    }
  } else if (isPublic) {
    if (chat?.picture) {
      avatar = (
        <ProxyImg
          width={18}
          square={true}
          src={chat.picture}
          alt="Channel Icon"
          className="rounded-full w-10 h-10"
        />
      )
    } else {
      avatar = (
        <div className="w-10 h-10 rounded-full bg-base-300 flex items-center justify-center">
          <span className="text-lg">#</span>
        </div>
      )
    }
  } else {
    avatar = <Avatar pubKey={pubKey} />
  }

  // Name/title rendering
  let title
  if (group) {
    title = group.name
  } else if (isPublic) {
    if (chat?.name) {
      title = (
        <>
          <RiEarthLine className="w-4 h-4" />
          {chat.name}
        </>
      )
    } else if (showPlaceholder) {
      title = (
        <>
          <RiEarthLine className="w-4 h-4" />
          {`Channel ${id.slice(0, 8)}...`}
        </>
      )
    } else {
      title = <RiEarthLine className="w-4 h-4" />
    }
  } else {
    title = <Name pubKey={pubKey} />
  }

  // Unread badge logic
  let unreadBadge = null
  if (isPublic) {
    if (latestMessage?.created_at && latestMessage.pubkey !== myPubKey) {
      const hasUnread = latestMessage.created_at * 1000 > lastSeenPublicTime
      if (!lastSeenPublicTime || hasUnread) {
        unreadBadge = <div className="indicator-item badge badge-primary badge-xs" />
      }
    }
  } else if (!group) {
    if (latest?.created_at && latest.pubkey !== "user") {
      const hasUnread = getMillisecondTimestamp(latest) > lastSeenPrivateTime
      if (!lastSeenPrivateTime || hasUnread) {
        unreadBadge = <div className="indicator-item badge badge-primary badge-xs" />
      }
    }
  }

  // Determine route for NavLink
  let chatRoute
  if (group) {
    chatRoute = `/chats/group/${id}`
  } else if (isPublic) {
    chatRoute = `/chats/${id}`
  } else {
    chatRoute = "/chats/chat"
  }

  return (
    <NavLink
      to={chatRoute}
      state={{id}}
      key={id}
      onClick={() => isPublic && updateLastSeenPublic(id)}
      className={classNames("px-2 py-4 flex items-center border-b border-custom", {
        "bg-base-300": isActive,
        "hover:bg-base-300": !isActive,
      })}
    >
      <div className="flex flex-row items-center gap-2 flex-1">
        {avatar}
        <div className="flex flex-col flex-1">
          <div className="flex flex-row items-center justify-between gap-2">
            <span className="text-base font-semibold flex items-center gap-1">
              {title}
            </span>
            <div className="flex flex-col gap-2">
              {(isPublic ? latestMessage?.created_at : latest?.created_at) && (
                <span className="text-sm text-base-content/70 ml-2">
                  <RelativeTime
                    from={(() => {
                      if (isPublic && latestMessage?.created_at) {
                        return latestMessage.created_at * 1000
                      } else {
                        return getMillisecondTimestamp(latest as MessageType)
                      }
                    })()}
                  />
                </span>
              )}
              {!isPublic && !group && <ConnectionStatus peerId={id} />}
            </div>
          </div>
          <div className="flex flex-row items-center justify-between gap-2">
            <span className="text-sm text-base-content/70 min-h-[1.25rem]">
              {previewContent}
            </span>
            {unreadBadge}
          </div>
        </div>
      </div>
    </NavLink>
  )
}

export default ChatListItem
