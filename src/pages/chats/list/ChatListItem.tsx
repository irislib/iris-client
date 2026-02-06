import RelativeTime from "@/shared/components/event/RelativeTime"
import {getMillisecondTimestamp} from "nostr-double-ratchet/src"
import {usePublicChatsStore} from "@/stores/publicChats"
import {Avatar} from "@/shared/components/user/Avatar"
import ProxyImg from "@/shared/components/ProxyImg"
import {shouldHideUser} from "@/utils/visibility"
import {Name} from "@/shared/components/user/Name"
import {KIND_CHANNEL_MESSAGE, KIND_CHANNEL_CREATE} from "@/utils/constants"
import {useLocation, NavLink} from "@/navigation"
import {MessageType} from "../message/Message"
import {usePrivateMessagesStore} from "@/stores/privateMessages"
import {RiEarthLine} from "@remixicon/react"
import {useUserStore} from "@/stores/user"
import {useEffect, useState, useMemo, useRef, type MouseEvent} from "react"
import classNames from "classnames"
import {ndk} from "@/utils/ndk"
import {useGroupsStore} from "@/stores/groups"
import {useTypingStore} from "@/stores/typingIndicators"
import MessageStatus from "../message/MessageStatus"
import {countUnseenMessages} from "@/pages/chats/utils/unseenCount"
import {useMessageRequestsStore} from "@/stores/messageRequests"
import {useMessagesStore} from "@/stores/messages"
import {getSessionManager} from "@/shared/services/PrivateChats"
import {markMessagesDeliveredAndMaybeSendReceipt} from "@/pages/chats/utils/deliveredReceipts"

interface ChatListItemProps {
  id: string
  isPublic?: boolean
  type?: string
  showRequestActions?: boolean
}

const ChatListItem = ({
  id,
  isPublic = false,
  type,
  showRequestActions = false,
}: ChatListItemProps) => {
  const location = useLocation()
  const pubKey = isPublic ? "" : id
  const isActive = location.state?.id === id
  const [showPlaceholder, setShowPlaceholder] = useState(false)

  // Subscribe only to this specific chat's messages to avoid unnecessary rerenders
  const privateMessages = usePrivateMessagesStore((state) =>
    type === "private" ? state.events.get(id) : null
  )
  const groupMessages = usePrivateMessagesStore((state) =>
    type === "group" ? state.events.get(id) : null
  )

  // Subscribe only to this specific public chat's data to avoid unnecessary rerenders
  const chat = usePublicChatsStore((state) => (isPublic ? state.publicChats[id] : null))
  const latestMessage = usePublicChatsStore((state) =>
    isPublic ? state.latestMessages[id] : null
  )
  const lastSeenPublicTime = usePublicChatsStore((state) =>
    isPublic ? state.lastSeen[id] || 0 : 0
  )
  const updateLastSeenPublic = usePublicChatsStore((state) => state.updateLastSeen)
  const updateLatestMessage = usePublicChatsStore((state) => state.updateLatestMessage)

  const myPubKey = useUserStore((state) => state.publicKey)
  const {groups} = useGroupsStore()
  const group = groups[id]
  const typingActive = useTypingStore(
    (state) => (type === "private" ? state.isTyping.get(id) ?? false : false)
  )
  const acceptChat = useMessageRequestsStore((state) => state.acceptChat)
  const rejectChat = useMessageRequestsStore((state) => state.rejectChat)
  const sendDeliveryReceipts = useMessagesStore((state) => state.sendDeliveryReceipts)

  // Memoize latest message to prevent flash when other chats update
  const actualLatest = useMemo(() => {
    if (type === "group") {
      return groupMessages?.last()?.[1]
    }
    if (type === "private") {
      return privateMessages?.last()?.[1]
    }
    return undefined
  }, [type, groupMessages, privateMessages])

  // Get chat data for unread counts
  const lastSeenPrivateTime = usePrivateMessagesStore(
    (state) => state.lastSeen.get(id) || 0
  )
  const markPrivateChatOpened = usePrivateMessagesStore((state) => state.markOpened)

  // Use ref to avoid effect recreation when store updates
  const updateLatestMessageRef = useRef(updateLatestMessage)
  updateLatestMessageRef.current = updateLatestMessage

  useEffect(() => {
    if (!isPublic) return
    // Validate id is a valid hex string before subscribing
    if (!/^[0-9a-f]{64}$/i.test(id)) return

    const sub = ndk().subscribe({
      kinds: [KIND_CHANNEL_MESSAGE],
      "#e": [id],
      limit: 1,
    })

    sub.on("event", (event) => {
      if (!event || !event.id) return
      if (shouldHideUser(event.pubkey)) return
      const currentLatest = usePublicChatsStore.getState().latestMessages[id]
      if (!currentLatest || event.created_at > currentLatest.created_at) {
        updateLatestMessageRef.current(id, {
          content: event.content,
          created_at: event.created_at,
          pubkey: event.pubkey,
          kind: event.kind,
        })
      }
    })

    return () => {
      sub.stop()
    }
  }, [id, isPublic])

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

  const previewContent = useMemo(() => {
    if (isPublic && latestMessage?.content) {
      // Show special preview for group invite messages
      if (latestMessage.kind === KIND_CHANNEL_CREATE) {
        return getGroupInvitePreview(
          latestMessage.pubkey,
          latestMessage.pubkey === myPubKey
        )
      }
      const content = latestMessage.content
      return content.length > 30 ? content.slice(0, 30) + "..." : content
    }

    if (actualLatest?.content) {
      // Show special preview for group invite messages
      if (actualLatest.kind === KIND_CHANNEL_CREATE) {
        return getGroupInvitePreview(
          actualLatest.pubkey,
          actualLatest.pubkey === myPubKey
        )
      }
      const content = actualLatest.content
      return content.length > 30 ? content.slice(0, 30) + "..." : content
    }

    return ""
  }, [isPublic, latestMessage, actualLatest, myPubKey])

  const lastPrivateMessage = type === "private" ? (actualLatest as MessageType | undefined) : undefined
  const lastPrivateIsMine =
    !!lastPrivateMessage &&
    (lastPrivateMessage.ownerPubkey ?? lastPrivateMessage.pubkey) === myPubKey

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

  const unseenCount = useMemo(() => {
    if (isPublic) {
      if (!latestMessage?.created_at) return 0
      if (latestMessage.pubkey === myPubKey) return 0
      const hasUnread =
        !lastSeenPublicTime || latestMessage.created_at * 1000 > lastSeenPublicTime
      return hasUnread ? 1 : 0
    }

    return countUnseenMessages({
      messages: group ? groupMessages : privateMessages,
      lastSeenAtMs: lastSeenPrivateTime,
      myPubKey,
    })
  }, [
    isPublic,
    latestMessage?.created_at,
    latestMessage?.pubkey,
    myPubKey,
    lastSeenPublicTime,
    group,
    groupMessages,
    privateMessages,
    lastSeenPrivateTime,
  ])

  const unseenLabel = unseenCount > 99 ? "99+" : String(unseenCount)
  const unreadBadge =
    unseenCount > 0 ? (
      <span className="badge badge-primary badge-sm shrink-0">{unseenLabel}</span>
    ) : null

  const shouldShowRequestActions =
    showRequestActions && type === "private" && !isPublic && !group

  const handleAccept = (e: MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()

    if (!id) return

    acceptChat(id)

    if (!myPubKey) return

    const sessionManager = getSessionManager()
    if (!sessionManager) return

    const messageMap = usePrivateMessagesStore.getState().events.get(id)
    if (!messageMap) return
    const store = usePrivateMessagesStore.getState()

    markMessagesDeliveredAndMaybeSendReceipt({
      chatId: id,
      messages: messageMap.values(),
      myPubKey,
      updateMessage: store.updateMessage,
      sessionManager,
      sendDeliveryReceipts,
      isChatAccepted: true,
    })
  }

  const handleReject = (e: MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()

    if (!id) return

    rejectChat(id)

    const sessionManager = getSessionManager()
    const store = usePrivateMessagesStore.getState()
    void Promise.all([
      sessionManager?.deleteUser(id).catch(() => {}),
      store.removeSession(id).catch(() => {}),
    ])
  }

  // Determine route for NavLink
  let chatRoute
  if (group) {
    chatRoute = `/chats/group/${id}`
  } else if (isPublic) {
    chatRoute = `/chats/${id}`
  } else {
    // For private chats, id is now userPubKey
    chatRoute = "/chats/chat"
  }

  return (
    <NavLink
      to={chatRoute}
      state={{id}}
      key={id}
      onClick={() => {
        if (isPublic) {
          updateLastSeenPublic(id)
        } else {
          markPrivateChatOpened(id)
        }
      }}
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
              {(isPublic ? latestMessage?.created_at : actualLatest?.created_at) && (
                <span className="text-sm text-base-content/70 ml-2 flex items-center gap-1">
                  <RelativeTime
                    from={(() => {
                      if (isPublic && latestMessage?.created_at) {
                        return latestMessage.created_at * 1000
                      } else {
                        return getMillisecondTimestamp(actualLatest as MessageType)
                      }
                    })()}
                  />
                </span>
              )}
            </div>
          </div>
          <div className="flex flex-row items-center justify-between gap-2">
            <span className="text-sm text-base-content/70 min-h-[1.25rem]">
              {typingActive ? (
                <span className="text-primary">typing...</span>
              ) : (
                previewContent
              )}
            </span>
            <div className="flex items-center gap-1 shrink-0">
              {shouldShowRequestActions ? (
                <>
                  {unreadBadge}
                  <button className="btn btn-xs btn-primary" onClick={handleAccept}>
                    Accept
                  </button>
                  <button
                    className="btn btn-ghost btn-xs text-error hover:bg-error hover:text-error-content"
                    onClick={handleReject}
                  >
                    Reject
                  </button>
                </>
              ) : (
                <>
                  {lastPrivateIsMine && (
                    <MessageStatus
                      status={lastPrivateMessage?.status}
                      sentToRelays={lastPrivateMessage?.sentToRelays}
                      className="w-3.5 h-3.5"
                    />
                  )}
                  {unreadBadge}
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </NavLink>
  )
}

export default ChatListItem
