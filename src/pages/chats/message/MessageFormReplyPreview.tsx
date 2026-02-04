import {Name} from "@/shared/components/user/Name"
import {RiCloseLine} from "@remixicon/react"
import {MessageType} from "./Message"
import {useUserStore} from "@/stores/user"

interface MessageFormReplyPreviewProps {
  replyingTo: MessageType
  setReplyingTo: (message?: MessageType) => void
}

const MessageFormReplyPreview = ({
  replyingTo,
  setReplyingTo,
}: MessageFormReplyPreviewProps) => {
  const myPublicKey = useUserStore.getState().publicKey
  // Use ownerPubkey if available (for DMs), otherwise use pubkey
  const authorPubkey = replyingTo.ownerPubkey ?? replyingTo.pubkey

  // Function to handle scrolling to the replied message
  const handleScrollToReply = () => {
    if (!replyingTo) return

    const element = document.getElementById(replyingTo.id)
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

  return (
    <div className="px-4 pt-2 flex items-center">
      <div className="flex-1 cursor-pointer" onClick={handleScrollToReply}>
        <div className="text-xs text-base-content/60 mb-1 font-bold">
          {authorPubkey === myPublicKey ? "You" : <Name pubKey={authorPubkey} />}
        </div>
        <div className="text-sm truncate border-l-2 border-primary pl-2 whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
          {replyingTo.content.length > 200
            ? `${replyingTo.content.slice(0, 200)}...`
            : replyingTo.content}
        </div>
      </div>
      <button
        type="button"
        onClick={() => setReplyingTo(undefined)}
        className="btn btn-ghost btn-circle btn-sm"
      >
        <RiCloseLine className="w-5 h-5" />
      </button>
    </div>
  )
}

export default MessageFormReplyPreview
