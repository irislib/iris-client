import {KIND_CHANNEL_MESSAGE, KIND_REACTION} from "@/utils/constants"
import {usePublicChatsStore} from "@/stores/publicChats"
import ChatContainer from "../components/ChatContainer"
import {SortedMap} from "@/utils/SortedMap/SortedMap"
import {comparator} from "../utils/messageGrouping"
import {shouldHideUser} from "@/utils/visibility"
import {useNavigate, useLocation} from "@/navigation"
import PublicChatHeader from "./PublicChatHeader"
import {useEffect, useState, useRef} from "react"
import MessageForm from "../message/MessageForm"
import {MessageType} from "../message/Message"
import {AppEvent} from "@/lib/nostr"
import {useUserStore} from "@/stores/user"
import {Helmet} from "react-helmet"
import {nostr} from "@/utils/nostrClient"
import debounce from "lodash/debounce"

let publicKey = useUserStore.getState().publicKey
useUserStore.subscribe((state) => (publicKey = state.publicKey))

const PublicChat = () => {
  // TODO: Revert chats to use router to use path=":id" prop and useParams hook
  const location = useLocation()
  const [, id] = location.pathname
    .split("/")
    .filter((segment) => typeof segment === "string" && segment.length > 0)

  const navigate = useNavigate()
  const {publicChats, addOrRefreshChatById} = usePublicChatsStore()
  const [messages, setMessages] = useState<SortedMap<string, MessageType>>(
    new SortedMap<string, MessageType>([], comparator)
  )
  const [displayedMessages, setDisplayedMessages] = useState<
    SortedMap<string, MessageType>
  >(new SortedMap<string, MessageType>([], comparator))
  const [replyingTo, setReplyingTo] = useState<MessageType>()
  const [error, setError] = useState<string | null>(null)
  const initialLoadDoneRef = useRef<boolean>(false)
  const [initialLoadDone, setInitialLoadDone] = useState(false)
  const [showNoMessages, setShowNoMessages] = useState(false)
  const timeoutRef = useRef<NodeJS.Timeout | null>(null)

  // Debounced function to update displayed messages
  const debouncedUpdateDisplayedMessages = debounce(
    (newMessages: SortedMap<string, MessageType>) => {
      setDisplayedMessages(newMessages)
    },
    300
  )

  useEffect(() => {
    if (!id) return
    // Validate id is a 64-char hex string before fetching
    if (!/^[0-9a-f]{64}$/i.test(id)) {
      console.warn("Invalid channel ID, skipping metadata fetch:", id)
      return
    }
    addOrRefreshChatById(id)
  }, [id, addOrRefreshChatById])

  // Update displayed messages when messages change (debounced)
  useEffect(() => {
    debouncedUpdateDisplayedMessages(messages)
  }, [messages, debouncedUpdateDisplayedMessages])

  // Set up timeout to show "No messages yet" after 2 seconds
  useEffect(() => {
    if (displayedMessages.size === 0) {
      // Clear any existing timeout
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }

      // Set a new timeout
      timeoutRef.current = setTimeout(() => {
        setShowNoMessages(true)
      }, 2000)
    } else {
      // If there are messages, don't show the "No messages yet" message
      setShowNoMessages(false)
    }

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }
    }
  }, [displayedMessages.size])

  // Set up continuous subscription for messages
  useEffect(() => {
    if (!id) return
    // Validate id is a 64-char hex string before subscribing
    if (!/^[0-9a-f]{64}$/i.test(id)) return

    // Set up subscription for channel messages
    const sub = nostr().subscribe({
      kinds: [KIND_CHANNEL_MESSAGE],
      "#e": [id],
    })

    // Handle new messages
    sub.on("event", (event) => {
      if (!event || !event.id) return
      if (shouldHideUser(event.pubkey)) return

      const newMessage: MessageType = {
        id: event.id,
        pubkey: event.pubkey === publicKey ? publicKey : event.pubkey,
        content: event.content,
        created_at: event.created_at,
        tags: event.tags,
        kind: KIND_CHANNEL_MESSAGE,
        reactions: {},
        sentToRelays: true, // Messages from subscription are already on relays
        nostrEventId: event.id, // Add nostrEventId for public messages
      }

      setMessages((prev) => {
        // Check if message already exists
        if (prev.has(newMessage.id)) {
          return prev
        }

        // Add new message to SortedMap
        const updated = new SortedMap(prev, comparator)
        updated.set(newMessage.id, newMessage)
        return updated
      })

      // Mark initial load as done after first message
      if (!initialLoadDoneRef.current) {
        initialLoadDoneRef.current = true
        setInitialLoadDone(true)
      }
    })

    // Clean up subscription when component unmounts
    return () => {
      sub.stop()
    }
  }, [id])

  const handleSendMessage = async (content: string) => {
    if (!content.trim() || !id) return

    try {
      if (!publicKey) {
        setError("You need to be logged in to send messages")
        return
      }

      // Create channel message event (kind 42)
      const event = new AppEvent(nostr())
      event.kind = KIND_CHANNEL_MESSAGE
      event.content = content

      // Add channel tag
      const tags = [["e", id, "", "root"]]

      // Add reply tag if replying to a message
      if (replyingTo) {
        tags.push(["e", replyingTo.id, "", "reply"])
      }

      event.tags = tags

      // Sign and publish the event
      await event.sign()
      const publishedRelays = await event.publish()

      // Add message to local state
      const newMessage: MessageType = {
        id: event.id,
        pubkey: publicKey,
        content: content,
        created_at: Math.floor(Date.now() / 1000),
        tags: event.tags,
        kind: KIND_CHANNEL_MESSAGE,
        reactions: {},
        sentToRelays: publishedRelays ? publishedRelays.size > 0 : false, // Only true if actually published to relays
        nostrEventId: event.id, // Add nostrEventId for public messages
      }

      setMessages((prev) => {
        const updated = new SortedMap(prev, comparator)
        updated.set(newMessage.id, newMessage)
        return updated
      })

      // Clear reply state after sending
      setReplyingTo(undefined)
    } catch (err) {
      console.error("Error sending message:", err)
      setError("Failed to send message")
    }
  }

  const handleSendReaction = async (messageId: string, emoji: string) => {
    if (!publicKey || !id) return

    try {
      // Create reaction event (kind 7)
      const event = new AppEvent(nostr())
      event.kind = KIND_REACTION
      event.content = emoji

      // Add tags for the message being reacted to and the chat root
      event.tags = [
        ["e", messageId, "", "reply"],
        ["e", id, "", "root"],
      ]

      // Sign and publish the event
      await event.sign()
      await event.publish()
    } catch (err) {
      console.error("Error sending reaction:", err)
      setError("Failed to send reaction")
    }
  }

  if (error) {
    return (
      <>
        <Helmet>
          <title>Error</title>
        </Helmet>
        <PublicChatHeader channelId={id || ""} />
        <div className="flex flex-col items-center justify-center h-full p-4">
          <p className="text-error mb-4">{error}</p>
          <button className="btn btn-primary" onClick={() => navigate("/chats")}>
            Back to Chats
          </button>
        </div>
      </>
    )
  }

  if (!id) {
    return (
      <>
        <Helmet>
          <title>Public Chat</title>
        </Helmet>
        <PublicChatHeader channelId={""} />
        <div className="flex flex-col items-center justify-center h-full p-4">
          <p className="text-error mb-4">Channel not found</p>
          <button className="btn btn-primary" onClick={() => navigate("/chats")}>
            Back to Chats
          </button>
        </div>
      </>
    )
  }

  return (
    <>
      <Helmet>
        <title>{(id && publicChats[id]?.name) || "Public Chat"}</title>
      </Helmet>
      <PublicChatHeader channelId={id || ""} />
      <ChatContainer
        messages={displayedMessages}
        sessionId={id}
        onReply={setReplyingTo}
        showAuthor={true}
        isPublicChat={true}
        initialLoadDone={initialLoadDone}
        showNoMessages={showNoMessages}
        onSendReaction={handleSendReaction}
      />
      {publicKey && (
        <MessageForm
          id={id || ""}
          replyingTo={replyingTo}
          setReplyingTo={setReplyingTo}
          onSendMessage={handleSendMessage}
          isPublicChat={true}
        />
      )}
    </>
  )
}

export default PublicChat
