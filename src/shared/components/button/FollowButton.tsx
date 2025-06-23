import {NDKEvent, NDKTag} from "@nostr-dev-kit/ndk"
import {PublicKey} from "@/shared/utils/PublicKey"
import {useMemo, useState, useEffect} from "react"

import {unmuteUser} from "@/shared/services/Mute"
import socialGraph from "@/utils/socialGraph.ts"
import {useUserStore} from "@/stores/user"
import {ndk} from "@/utils/ndk"

export function FollowButton({pubKey, small = true}: {pubKey: string; small?: boolean}) {
  const myPubKey = useUserStore((state) => state.publicKey)
  const [isHovering, setIsHovering] = useState(false)
  const [, setUpdated] = useState(0)

  const isTestEnvironment =
    typeof window !== "undefined" && window.location.href.includes("localhost:5173")

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
      isFollowing = socialGraph().isFollowing(myPubKey, pubKeyHex)
      isMuted = socialGraph().getMutedByUser(myPubKey).has(pubKeyHex)
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

  const handleClick = () => {
    if (!myPubKey || !pubKeyHex) {
      console.error("Cannot handle click: missing keys")
      return
    }

    setLocalIsFollowing(!localIsFollowing)

    const event = new NDKEvent(ndk())
    event.kind = 3
    const followedUsers = socialGraph().getFollowedByUser(myPubKey)

    if (isFollowing) {
      followedUsers.delete(pubKeyHex)
    } else {
      followedUsers.add(pubKeyHex)
      if (isMuted) {
        unmuteUser(pubKeyHex)
      }
    }

    event.tags = Array.from(followedUsers).map((pubKey) => ["p", pubKey]) as NDKTag[]
    event.publish().catch((e) => console.warn("Error publishing follow event:", e))

    setTimeout(() => {
      setUpdated((updated) => updated + 1)
    }, 1000)
  }

  // text should be Follow or Following. if Following, on hover it should say Unfollow
  let text = "Follow"
  let className = "btn-primary"
  if (isMuted) {
    text = "Unmute"
    className = "btn-secondary"
  } else if (localIsFollowing) {
    text = isHovering ? "Unfollow" : "Following"
    className = isHovering ? "btn-secondary" : "btn-success"
  }

  return (
    <button
      className={`btn ${small ? "btn-sm" : ""} ${className}`}
      onClick={handleClick}
      onMouseEnter={() => setIsHovering(true)}
      onMouseLeave={() => setIsHovering(false)}
    >
      {text}
    </button>
  )
}
