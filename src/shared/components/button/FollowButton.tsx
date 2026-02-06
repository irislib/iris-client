import {NDKEvent, NDKTag} from "@/lib/ndk"
import {PublicKey} from "@/shared/utils/PublicKey"
import {useMemo, useState, useEffect} from "react"

import {unmuteUser} from "@/shared/services/Mute"
import {useSocialGraph, handleSocialGraphEvent} from "@/utils/socialGraph.ts"
import {useUserStore} from "@/stores/user"
import {ndk} from "@/utils/ndk"
import {getUnmuteLabel} from "@/utils/muteLabels"
import {NostrEvent} from "nostr-social-graph"

export function FollowButton({pubKey, small = true}: {pubKey: string; small?: boolean}) {
  const socialGraph = useSocialGraph()
  const myPubKey = useUserStore((state) => state.publicKey)
  const [isHovering, setIsHovering] = useState(false)
  const [, setUpdated] = useState(0)

  const isTestEnvironment = import.meta.env.VITE_E2E === "true"

  const pubKeyHex = useMemo(() => {
    if (!pubKey) return null
    try {
      return new PublicKey(pubKey).toString()
    } catch (error) {
      console.error("Invalid public key:", pubKey, error)
      return null
    }
  }, [pubKey])

  let isFollowing = false
  let isMuted = false

  try {
    if (myPubKey && pubKeyHex) {
      isFollowing = socialGraph.isFollowing(myPubKey, pubKeyHex)
      isMuted = socialGraph.getMutedByUser(myPubKey).has(pubKeyHex)
    }
  } catch (error) {
    console.error("Error checking social graph:", error)
  }

  const [localIsFollowing, setLocalIsFollowing] = useState(isFollowing)

  useEffect(() => {
    setLocalIsFollowing(isFollowing)
  }, [isFollowing])

  if ((!myPubKey || !pubKeyHex || pubKeyHex === myPubKey) && !isTestEnvironment) {
    return null
  }

  const handleClick = async () => {
    if (!myPubKey || !pubKeyHex) {
      console.error("Cannot handle click: missing keys")
      return
    }

    const event = new NDKEvent(ndk())
    event.kind = 3
    const followedUsers = socialGraph.getFollowedByUser(myPubKey)

    if (isMuted) {
      // Handle unmute case - just unmute, don't follow
      try {
        await unmuteUser(pubKeyHex)
        // Force a re-render to update the button state
        setUpdated((updated) => updated + 1)
      } catch (error) {
        console.error("Error unmuting user:", error)
      }
      return // Don't proceed with follow/unfollow logic
    }

    setLocalIsFollowing(!localIsFollowing)

    if (isFollowing) {
      followedUsers.delete(pubKeyHex)
    } else {
      followedUsers.add(pubKeyHex)
    }

    event.tags = Array.from(followedUsers).map((pubKey) => ["p", pubKey]) as NDKTag[]
    event.created_at = Math.floor(Date.now() / 1000)
    event.pubkey = myPubKey

    // Feed to social graph immediately for instant UI update
    handleSocialGraphEvent(event as unknown as NostrEvent)

    event.publish().catch((e) => console.warn("Error publishing follow event:", e))

    setTimeout(() => {
      setUpdated((updated) => updated + 1)
    }, 1000)
  }

  // text should be Follow or Following. if Following, on hover it should say Unfollow
  let text = "Follow"
  let className = "btn-info"
  if (isMuted) {
    text = getUnmuteLabel()
    className = "btn-secondary"
  } else if (localIsFollowing) {
    text = isHovering ? "Unfollow" : "Following"
    className = isHovering ? "btn-error" : "btn-neutral"
  }

  return (
    <button
      className={`btn ${small ? "btn-sm" : ""} ${className} relative`}
      onClick={handleClick}
      onMouseEnter={() => setIsHovering(true)}
      onMouseLeave={() => setIsHovering(false)}
    >
      <span className="invisible">Following</span>
      <span className="absolute inset-0 flex items-center justify-center">{text}</span>
    </button>
  )
}
