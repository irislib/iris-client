import {CHANNEL_CREATE, CHANNEL_MESSAGE} from "../utils/constants"
import {PublicChatContext} from "../public/PublicChatContext"
import Header from "@/shared/components/header/Header"
import ChatListItem from "./ChatListItem"
import {useState, useEffect} from "react"
import {localState} from "irisdb/src"
import {NavLink} from "react-router"
import classNames from "classnames"
import {ndk} from "@/utils/ndk"

interface ChatListProps {
  className?: string
}

type LatestMessage = {
  content: string
  id: string
  sender: string
  created_at: number
}

type Session = {
  deleted?: boolean
  lastSeen?: number
  events?: Record<string, unknown>
  latest?: LatestMessage
}

type PublicChat = {
  id: string
  name: string
  about: string
  picture: string
  lastMessage?: string
  lastMessageAt?: number
}

const ChatList = ({className}: ChatListProps) => {
  const [sessions, setSessions] = useState({} as Record<string, Session>)
  const [publicChats, setPublicChats] = useState<PublicChat[]>([])
  const [userPublicKey, setUserPublicKey] = useState<string>("")
  const [publicChatTimestamps, setPublicChatTimestamps] = useState<
    Record<string, number>
  >({})

  useEffect(() => {
    localState.get("sessions").put({})

    const unsub = localState.get("sessions").on(
      (sessions) => {
        if (!sessions || typeof sessions !== "object") return
        setSessions({...sessions} as Record<string, Session>)
      },
      false,
      3
    )

    // Get user's public key
    const unsubPubKey = localState.get("user/publicKey").on((key) => {
      if (key && typeof key === "string") {
        setUserPublicKey(key)
      }
    })

    return () => {
      unsub()
      unsubPubKey()
    }
  }, [])

  // Fetch public chats where the user has sent messages
  useEffect(() => {
    if (!userPublicKey) return

    const fetchPublicChats = async () => {
      try {
        // Fetch channel messages (kind 42) from the user
        const events = await ndk().fetchEvents({
          kinds: [CHANNEL_MESSAGE],
          authors: [userPublicKey],
          limit: 100,
        })

        // Extract unique channel IDs
        const channelIds = new Set<string>([
          "1d2f13b495d7425b70298a8acd375897a632562043d461e89b63499363eaf8e7",
        ])
        events.forEach((event) => {
          // In NIP-28, channel messages have an "e" tag with the channel ID
          const channelIdTag = event.tags.find(
            (tag) => tag[0] === "e" && tag[3] === "root"
          )
          if (channelIdTag && channelIdTag[1]) {
            channelIds.add(channelIdTag[1])
          }
        })

        // Fetch channel metadata for each channel
        const chats: PublicChat[] = []
        for (const channelId of channelIds) {
          try {
            // Fetch channel creation event (kind 40)
            const channelEvent = await ndk().fetchEvent({
              kinds: [CHANNEL_CREATE],
              ids: [channelId],
            })

            if (channelEvent) {
              try {
                const metadata = JSON.parse(channelEvent.content)
                chats.push({
                  id: channelId,
                  name: metadata.name || `Channel ${channelId.slice(0, 8)}...`,
                  about: metadata.about || "",
                  picture: metadata.picture || "",
                })
              } catch (e) {
                console.error("Failed to parse channel creation content:", e)
                chats.push({
                  id: channelId,
                  name: `Channel ${channelId.slice(0, 8)}...`,
                  about: "",
                  picture: "",
                })
              }
            } else {
              chats.push({
                id: channelId,
                name: `Channel ${channelId.slice(0, 8)}...`,
                about: "",
                picture: "",
              })
            }
          } catch (err) {
            console.error("Error fetching channel metadata:", err)
            chats.push({
              id: channelId,
              name: `Channel ${channelId.slice(0, 8)}...`,
              about: "",
              picture: "",
            })
          }
        }

        setPublicChats(chats)
      } catch (err) {
        console.error("Error fetching public chats:", err)
      }
    }

    fetchPublicChats()
  }, [userPublicKey])

  // Combine private and public chats for display
  const allChats = Object.values(
    [
      ...Object.entries(sessions)
        .filter(([, session]) => !!session && !session.deleted)
        .map(([id]) => ({id, isPublic: false})),
      ...publicChats.map((chat) => ({id: chat.id, isPublic: true})),
    ].reduce(
      (acc, chat) => {
        // If chat has empty string as id, skip it (appears on recursion depth 3 on sessions)
        if (chat.id === "") {
          return acc
        }
        // If chat doesn't exist or current chat is newer, update it
        if (!acc[chat.id] || (chat.isPublic && !acc[chat.id].isPublic)) {
          acc[chat.id] = chat
        }
        return acc
      },
      {} as Record<string, {id: string; isPublic: boolean}>
    )
  )

  // Sort all chats by most recent activity
  const sortedChats = allChats.sort((a, b) => {
    // Get latest message time for chat A
    let aLatest = 0
    if (a.isPublic) {
      aLatest = publicChatTimestamps[a.id] || 0
    } else {
      aLatest = sessions[a.id]?.latest?.created_at || 0
    }

    // Get latest message time for chat B
    let bLatest = 0
    if (b.isPublic) {
      bLatest = publicChatTimestamps[b.id] || 0
    } else {
      bLatest = sessions[b.id]?.latest?.created_at || 0
    }

    // Sort in descending order (newest first)
    return bLatest - aLatest
  })

  console.log("allChats", allChats)

  return (
    <PublicChatContext.Provider value={{setPublicChatTimestamps}}>
      <nav className={className}>
        <div className="md:hidden">
          <Header title="Chats" slideUp={false} />
        </div>
        <div className="flex flex-col">
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
            <div className="flex flex-col">
              <span className="text-base font-semibold">New Chat</span>
              <span className="text-sm text-base-content/70">
                Start a new conversation
              </span>
            </div>
          </NavLink>
          {sortedChats.map(({id, isPublic}) => (
            <ChatListItem key={id} id={id} isPublic={isPublic} />
          ))}
        </div>
      </nav>
    </PublicChatContext.Provider>
  )
}

export default ChatList
