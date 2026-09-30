import {AppEvent} from "@/lib/nostr"
import {nip19} from "nostr-tools"
import {RiShare2Line} from "@remixicon/react"

const FeedItemShare = ({event}: {event: AppEvent}) => {
  if (!navigator.share) {
    return null
  }

  const handleShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          url: `https://iris.to/${nip19.noteEncode(event.id)}`,
        })
      } catch (error) {
        console.error("Error sharing:", error)
      }
    } else {
      console.warn("Web Share API is not supported in this browser.")
    }
  }

  return (
    <button onClick={handleShare} className="shareButton hover:text-info" title="Share">
      <RiShare2Line size={16} />
    </button>
  )
}

export default FeedItemShare
