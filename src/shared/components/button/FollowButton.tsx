import {PublicKey} from "irisdb-nostr/src/Hex/PublicKey"
import {NDKEvent, NDKTag} from "@nostr-dev-kit/ndk"
import {useMemo, useState} from "react"

import {unmuteUser} from "@/shared/services/Mute"
import socialGraph from "@/utils/socialGraph.ts"
import {useUserStore} from "@/stores/user"
import {ndk} from "@/utils/ndk"

export function FollowButton({pubKey, small = true}: {pubKey: string; small?: boolean}) {
  const myPubKey = useUserStore((state) => state.publicKey)
  const [isHovering, setIsHovering] = useState(false)
  const [, setUpdated] = useState(0)
  const pubKeyHex = useMemo(() => {
    if (!pubKey) return null
    try {
      return new PublicKey(pubKey).toString()
    } catch (error) {
      console.error("Invalid public key:", pubKey, error)
      return null
    }
  }, [pubKey])
  const isFollowing =
    myPubKey && pubKeyHex && socialGraph().isFollowing(myPubKey, pubKeyHex)
  const isMuted = pubKeyHex && socialGraph().getMutedByUser(myPubKey).has(pubKeyHex)

  if (!myPubKey || !pubKeyHex || pubKeyHex === myPubKey) {
    return null
  }

  const handleClick = () => {
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
  } else if (isFollowing) {
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
