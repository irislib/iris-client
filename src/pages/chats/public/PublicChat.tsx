import PublicChatHeader from "./PublicChatHeader"
import ChatContainer from "../components/ChatContainer"
import {SortedMap} from "@/utils/SortedMap/SortedMap"
import {shouldHideAuthor} from "@/utils/visibility"
import {useNavigate, useParams} from "react-router"
import {comparator} from "../utils/messageGrouping"
import {useEffect, useState, useRef} from "react"
import {Session} from "nostr-double-ratchet/src"
import {NDKEvent} from "@nostr-dev-kit/ndk"
import MessageForm from "../message/MessageForm"
import {MessageType} from "../message/Message"
import {Helmet} from "react-helmet"
import {ndk} from "@/utils/ndk"
import {fetchChannelMetadata, ChannelMetadata} from "../utils/channelMetadata"
import {CHANNEL_MESSAGE, REACTION_KIND} from "../utils/constants"
import {useUserStore} from "@/stores/user"

let publicKey = useUserStore.getState().publicKey
useUserStore.subscribe((state) => (publicKey = state.publicKey))

const PublicChat = () => {
  const {id} = useParams<{id: string}>()
  const navigate = useNavigate()
  const [metadata, setMetadata] = useState<ChannelMetadata | null>(null)
  const [messages, setMessages] = useState<SortedMap<string, MessageType>>(
    new SortedMap<string, MessageType>([], comparator)
  )
  const [reactions, setReactions] = useState<Record<string, Record<string, string>>>({})
  const [replyingTo, setReplyingTo] = useState<MessageType>()
  const [error, setError] = useState<string | null>(null)
  const [session] = useState<Session>({} as Session) // Dummy session for public chat
  const initialLoadDoneRef = useRef<boolean>(false)
  const [initialLoadDone, setInitialLoadDone] = useState(false)
  const [showNoMessages, setShowNoMessages] = useState(false)
  const timeoutRef = useRef<NodeJS.Timeout | null>(null)

  // Fetch channel metadata
  useEffect(() => {
    if (!id) return

    const getMetadata = async () => {
      try {
        const data = await fetchChannelMetadata(id)
        setMetadata(data)
      } catch (err) {
        console.error("Error fetching channel metadata:", err)
      }
    }

    getMetadata()
  }, [id])

  // Set up timeout to show "No messages yet" after 2 seconds
  useEffect(() => {
    if (messages.size === 0) {
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
  }, [messages.size])

  // Set up continuous subscription for messages
  useEffect(() => {
    if (!id) return

    // Set up subscription for channel messages
    const sub = ndk().subscribe({
      kinds: [CHANNEL_MESSAGE],
      "#e": [id],
    })

    // Handle new messages
    sub.on("event", (event) => {
      if (!event || !event.id) return
      if (shouldHideAuthor(event.pubkey)) return

      const newMessage: MessageType = {
        id: event.id,
        pubkey: event.pubkey,
        content: event.content,
        created_at: event.created_at,
        tags: event.tags,
        kind: CHANNEL_MESSAGE,
        sender: event.pubkey === publicKey ? "user" : undefined,
        reactions: {},
      }

      setMessages((prev) => {
        // Check if message already exists
        if (prev.has(newMessage.id)) {
          return prev
        }

        // Check if there are any pending reactions for this message
        const pendingReactionsForMessage = reactions[newMessage.id] || {}
        if (Object.keys(pendingReactionsForMessage).length > 0) {
          // Create a copy of the reactions
          const updatedReactions = {...newMessage.reactions}

          // Apply all pending reactions
          Object.entries(pendingReactionsForMessage).forEach(([reactionPubkey, reactionContent]) => {
            updatedReactions[reactionPubkey] = reactionContent
          })

          // Update the message with the reactions
          newMessage.reactions = updatedReactions

          // Remove the pending reactions for this message
          setReactions((prev) => {
            const updated = {...prev}
            delete updated[newMessage.id]
            return updated
          })
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
      const event = new NDKEvent(ndk())
      event.kind = CHANNEL_MESSAGE
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
      await event.publish()

      // Add message to local state
      const newMessage: MessageType = {
        id: event.id,
        pubkey: publicKey,
        content: content,
        created_at: Math.floor(Date.now() / 1000),
        tags: event.tags,
        kind: CHANNEL_MESSAGE,
        sender: "user",
        reactions: {},
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
      const event = new NDKEvent(ndk())
      event.kind = REACTION_KIND
      event.content = emoji

      // Add tags for the message being reacted to and the chat root
      event.tags = [
        ["e", messageId, "", "reply"],
        ["e", id, "", "root"],
      ]

      // Sign and publish the event
      await event.sign()
      await event.publish()

      // Update reactions state immediately for better UX
      setReactions((prev) => {
        const messageReactions = prev[messageId] || {}
        return {
          ...prev,
          [messageId]: {
            ...messageReactions,
            [publicKey]: emoji,
          },
        }
      })
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

  return (
    <>
      <Helmet>
        <title>{metadata?.name || "Public Chat"}</title>
      </Helmet>
      <PublicChatHeader channelId={id || ""} />
      <ChatContainer
        messages={messages}
        session={session} // TODO: remove this when fixing reactions
        sessionId={id || ""} // TODO: remove this when fixing reactions
        onReply={setReplyingTo}
        showAuthor={true}
        isPublicChat={true}
        initialLoadDone={initialLoadDone}
        showNoMessages={showNoMessages}
        onSendReaction={handleSendReaction}
        reactions={reactions}
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
