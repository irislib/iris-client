import {Name} from "@/shared/components/user/Name"
import {useState, useEffect} from "react"
import {MessageType} from "./Message"
import classNames from "classnames"
import {localState} from "irisdb"

type ReplyPreviewProps = {
  isUser: boolean
  sessionId: string
  replyToId: string
}

const ReplyPreview = ({isUser, sessionId, replyToId}: ReplyPreviewProps) => {
  // TODO this initialised with null causes chat open scrolldown to not work properly
  const [repliedToMessage, setRepliedToMessage] = useState<MessageType | null>(null)

  // No need to find the reply tag here since we're passing it directly
  const theirPublicKey = sessionId.split(":")[0]

  // Function to handle scrolling to the replied message
  const handleScrollToReply = () => {
    const element = document.getElementById(replyToId)
    if (element) {
      element.scrollIntoView({
        behavior: "smooth",
        block: "center",
      })
      // Optional: highlight the message briefly
      element.classList.add("highlight-message")
      setTimeout(() => element.classList.remove("highlight-message"), 2000)
    }
  }

  // Fetch the replied-to message if it exists
  useEffect(() => {
    if (!replyToId) return

    const fetchReplyMessage = async () => {
      try {
        const replyMsg = await localState
          .get("sessions")
          .get(sessionId)
          .get("events")
          .get(replyToId)
          .once()

        if (replyMsg && typeof replyMsg === "object") {
          setRepliedToMessage(replyMsg as MessageType)
        }
      } catch (error) {
        console.error("Error fetching replied-to message:", error)
      }
    }

    fetchReplyMessage()
  }, [replyToId, sessionId])

  if (!repliedToMessage) return null

  return (
    <div
      className={classNames(
        "text-xs px-3 py-1 mb-1 rounded-t-lg border-l-2 border-base-content/30 cursor-pointer",
        isUser
          ? "bg-primary/20 text-primary-content/70"
          : "bg-neutral/20 text-neutral-content/70"
      )}
      onClick={handleScrollToReply}
    >
      <div className="font-semibold">
        {repliedToMessage.sender === "user" ? (
          "You"
        ) : (
          <Name pubKey={theirPublicKey} />
        )}{" "}
      </div>
      <div className="truncate max-w-[250px]">{repliedToMessage.content}</div>
    </div>
  )
}

export default ReplyPreview
