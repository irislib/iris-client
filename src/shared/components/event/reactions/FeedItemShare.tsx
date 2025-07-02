import Icon from "@/shared/components/Icons/Icon"
import {NDKEvent} from "@nostr-dev-kit/ndk"
import {nip19} from "nostr-tools"

const FeedItemShare = ({event}: {event: NDKEvent}) => {
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
    <button onClick={handleShare} className="reaction-btn hover:text-info" title="Share">
      <Icon name="share" className="sidebar-nav-icon" />
    </button>
  )
}

export default FeedItemShare
