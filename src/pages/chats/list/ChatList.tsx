import {usePublicChatsStore} from "@/stores/publicChats"
import Header from "@/shared/components/header/Header"
import ChatListItem from "./ChatListItem"
import {NavLink} from "@/navigation"
import classNames from "classnames"
import {useEffect, useMemo} from "react"
import {RiChatNewLine} from "@remixicon/react"
import {useGroupsStore} from "@/stores/groups"
import {usePrivateMessagesStore} from "@/stores/privateMessages"
import {SortedMap} from "@/utils/SortedMap/SortedMap"
import {comparator} from "@/pages/chats/utils/messageGrouping"
import {getMillisecondTimestamp} from "nostr-double-ratchet/src"
import {MessageType} from "@/pages/chats/message/Message"
import EncryptedMessagingOnboardingPrompt from "@/shared/components/EncryptedMessagingOnboardingPrompt"
import {useMessagesStore} from "@/stores/messages"
import {useUserStore} from "@/stores/user"
import {useFollowsFromGraph} from "@/utils/socialGraph"
import {useMessageRequestsStore} from "@/stores/messageRequests"
import {useUIStore} from "@/stores/ui"

interface ChatListProps {
  className?: string
}

const ChatList = ({className}: ChatListProps) => {
  const {publicChats, timestamps, addOrRefreshChatById} = usePublicChatsStore()
  const {groups} = useGroupsStore()
  const enablePublicChats = useMessagesStore((state) => state.enablePublicChats)
  const myPubKey = useUserStore((state) => state.publicKey)
  const myFollows = useFollowsFromGraph(myPubKey, false)
  const activeTab = useUIStore((state) => state.chatsListActiveTab)
  const setActiveTab = useUIStore((state) => state.setChatsListActiveTab)
  const acceptedChats = useMessageRequestsStore((state) => state.acceptedChats)
  const rejectedChats = useMessageRequestsStore((state) => state.rejectedChats)

  // Subscribe only to events Map keys (chat IDs) to minimize rerenders
  const events = usePrivateMessagesStore((state) => state.events)

  const followsSet = useMemo(() => new Set(myFollows), [myFollows])

  const privateChatLatestTimestamps = useMemo(() => {
    const latestMap = new Map<string, number>()
    for (const [userPubKey, messageMap] of events.entries()) {
      // Skip group IDs (groups are handled separately)
      if (groups[userPubKey]) continue

      const [, latest] = messageMap.last() ?? []
      if (!latest) {
        latestMap.set(userPubKey, 0)
        continue
      }
      const timestamp = getMillisecondTimestamp(latest as MessageType)
      latestMap.set(userPubKey, timestamp)
    }
    return latestMap
  }, [events, groups])

  const privateChatsList = useMemo(
    () =>
      Array.from(privateChatLatestTimestamps.entries()).map(
        ([userPubKey, lastMessageTime]) => ({userPubKey, lastMessageTime})
      ),
    [privateChatLatestTimestamps]
  )

  const privateChatSections = useMemo(() => {
    const all: Array<{id: string; type: "private"}> = []
    const requests: Array<{id: string; type: "private"}> = []

    // "Accepted" = we follow them OR we explicitly accepted OR we've already sent at least one message.
    for (const {userPubKey} of privateChatsList) {
      if (rejectedChats[userPubKey]) continue

      const isFollowed = followsSet.has(userPubKey)
      const isLocallyAccepted = !!acceptedChats[userPubKey]
      let hasSent = false
      if (!isFollowed && !isLocallyAccepted && myPubKey) {
        const messageMap = events.get(userPubKey)
        if (messageMap) {
          for (const msg of messageMap.values()) {
            const owner = msg.ownerPubkey ?? msg.pubkey
            if (owner === myPubKey) {
              hasSent = true
              break
            }
          }
        }
      }

      if (isFollowed || isLocallyAccepted || hasSent) {
        all.push({id: userPubKey, type: "private"})
      } else {
        requests.push({id: userPubKey, type: "private"})
      }
    }

    return {all, requests}
  }, [privateChatsList, followsSet, events, myPubKey, acceptedChats, rejectedChats])

  useEffect(() => {
    if (!enablePublicChats) return
    Object.keys(publicChats).forEach((chatId) => {
      // Validate chatId is a 64-char hex string before fetching
      if (!/^[0-9a-f]{64}$/i.test(chatId)) {
        console.warn("Invalid channel ID in publicChats:", chatId)
        return
      }

      const chat = publicChats[chatId]
      if (!chat.metadata) {
        addOrRefreshChatById(chatId)
      }
    })
  }, [publicChats, addOrRefreshChatById, enablePublicChats])

  const latestForGroup = (id: string) => {
    const events = usePrivateMessagesStore.getState().events
    const messages = events.get(id) ?? new SortedMap([], comparator)
    const lastMsg = messages.last()?.[1]
    if (!lastMsg) return 0
    return lastMsg.created_at ? new Date(lastMsg.created_at * 1000).getTime() : 0
  }

  const latestForPublicChat = (id: string) => {
    const latest = timestamps[id] || 0
    return latest * 1000
  }

  const getLatest = (id: string, type: string) => {
    if (type === "group") return latestForGroup(id)
    if (type === "public") return latestForPublicChat(id)
    // For private chats, use the lastMessageTime from chats store
    return privateChatLatestTimestamps.get(id) || 0
  }

  const requestCount = privateChatSections.requests.length

  const chatItems = useMemo(() => {
    if (activeTab === "requests") {
      return [...privateChatSections.requests].sort(
        (a, b) => getLatest(b.id, b.type) - getLatest(a.id, a.type)
      )
    }

    return [
      ...Object.values(groups).map((group) => ({id: group.id, type: "group"})),
      ...privateChatSections.all,
      ...(enablePublicChats
        ? Object.keys(publicChats).map((chatId) => ({id: chatId, type: "public"}))
        : []),
    ].sort((a, b) => getLatest(b.id, b.type) - getLatest(a.id, a.type))
  }, [
    activeTab,
    groups,
    privateChatSections,
    enablePublicChats,
    publicChats,
    timestamps,
    privateChatLatestTimestamps,
  ])

  const tabButtonClasses = (isActive: boolean) =>
    classNames(
      "flex-1 cursor-pointer flex items-center justify-center gap-2 p-3 text-sm font-semibold border-b border-custom",
      isActive
        ? "border-b-2 border-highlight text-base-content"
        : "text-base-content/70 hover:text-base-content border-b-2 border-transparent"
    )

  return (
    <nav className={classNames("flex flex-col h-full", className)}>
      <div className="md:hidden">
        <Header title="Chats" slideUp={false} />
      </div>
      <div className="flex-1 overflow-y-auto">
        <div className="flex flex-col pt-[calc(4rem+env(safe-area-inset-top))] md:pt-0 pb-[calc(4rem+env(safe-area-inset-bottom))] md:pb-0">
          <EncryptedMessagingOnboardingPrompt />
          <NavLink
            to="/chats/new"
            end
            className={({isActive}) =>
              classNames("p-4 flex items-center border-b border-custom", {
                "bg-base-300": isActive,
                "hover:bg-base-300": !isActive,
              })
            }
          >
            <div className="flex items-center gap-3">
              <RiChatNewLine className="w-5 h-5" />
              <span className="text-base font-semibold">New Chat</span>
            </div>
          </NavLink>
          <div className="flex">
            <button
              type="button"
              className={tabButtonClasses(activeTab === "all")}
              onClick={() => setActiveTab("all")}
            >
              All
            </button>
            <button
              type="button"
              className={tabButtonClasses(activeTab === "requests")}
              onClick={() => setActiveTab("requests")}
            >
              Requests
              {requestCount > 0 && (
                <span className="badge badge-primary badge-sm">{requestCount}</span>
              )}
            </button>
          </div>
          {chatItems.map(({id, type}) => (
            <ChatListItem key={id} id={id} isPublic={type === "public"} type={type} />
          ))}
        </div>
      </div>
    </nav>
  )
}

export default ChatList
