import {NDKEvent, NDKTag} from "@/lib/ndk"
import {PublicKey} from "@/shared/utils/PublicKey"
import {useMemo, useState, useEffect} from "react"

import {unmuteUser} from "@/shared/services/Mute"
import {useSocialGraph, handleSocialGraphEvent} from "@/utils/socialGraph.ts"
import {useUserStore} from "@/stores/user"
import {ndk} from "@/utils/ndk"
import {getUnmuteLabel} from "@/utils/muteLabels"
import {NostrEvent} from "nostr-social-graph"
import {enqueueContactListPublish} from "@/utils/contactListPublishQueue"

const lastContactListTimestamps = new Map<string, number>()

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
  const [isPublishing, setIsPublishing] = useState(false)

  useEffect(() => {
    setLocalIsFollowing(isFollowing)
  }, [isFollowing])

  if ((!myPubKey || !pubKeyHex || pubKeyHex === myPubKey) && !isTestEnvironment) {
    return null
  }

  const handleClick = async () => {
    if (isPublishing) return
    if (!myPubKey || !pubKeyHex) {
      console.error("Cannot handle click: missing keys")
      return
    }

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

    const nextIsFollowing = !isFollowing
    setLocalIsFollowing(nextIsFollowing)
    setIsPublishing(true)
    try {
      await enqueueContactListPublish(myPubKey, async () => {
        const nextFollowedUsers = new Set(socialGraph.getFollowedByUser(myPubKey))
        if (nextIsFollowing) {
          nextFollowedUsers.add(pubKeyHex)
        } else {
          nextFollowedUsers.delete(pubKeyHex)
        }

        const event = new NDKEvent(ndk())
        event.kind = 3
        event.tags = Array.from(nextFollowedUsers).map((pubKey) => [
          "p",
          pubKey,
        ]) as NDKTag[]
        const lastTimestamp = lastContactListTimestamps.get(myPubKey) ?? 0
        event.created_at = Math.max(Math.floor(Date.now() / 1000), lastTimestamp + 1)
        lastContactListTimestamps.set(myPubKey, event.created_at)
        event.pubkey = myPubKey

        await event.publish()
        handleSocialGraphEvent(event as unknown as NostrEvent)
      })
      setUpdated((updated) => updated + 1)
    } catch (error) {
      setLocalIsFollowing(isFollowing)
      console.warn("Error publishing follow event:", error)
    } finally {
      setIsPublishing(false)
    }
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
      disabled={isPublishing}
      aria-busy={isPublishing}
      onMouseEnter={() => setIsHovering(true)}
      onMouseLeave={() => setIsHovering(false)}
    >
      <span className="invisible">Following</span>
      <span className="absolute inset-0 flex items-center justify-center">{text}</span>
    </button>
  )
}
