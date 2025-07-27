import socialGraph, {handleSocialGraphEvent} from "@/utils/socialGraph.ts"
import {PublicKey} from "@/shared/utils/PublicKey"
import {useEffect, useState, useMemo, useRef} from "react"
import {NostrEvent} from "nostr-tools"
import {subscribe} from "@/utils/applesauce"

// Helper function to get matching tags (replacing NDK's getMatchingTags)
function getMatchingTags(event: NostrEvent, tagName: string): string[][] {
  return event.tags.filter((tag) => tag[0] === tagName)
}

const useFollows = (pubKey: string | null | undefined, includeSelf = false) => {
  const pubKeyHex = useMemo(
    () => (pubKey ? new PublicKey(pubKey).toString() : ""),
    [pubKey]
  )
  const [follows, setFollows] = useState<string[]>([])
  const subscriptionRef = useRef<any | null>(null)

  // Initialize follows when pubKeyHex changes
  useEffect(() => {
    if (pubKeyHex) {
      setFollows([...socialGraph().getFollowedByUser(pubKeyHex, includeSelf)])
    } else {
      setFollows([])
    }
  }, [pubKeyHex, includeSelf])

  useEffect(() => {
    // Clean up any existing subscription first
    if (subscriptionRef.current) {
      subscriptionRef.current.stop()
      // Force cleanup by removing from subscription manager (NDK bug workaround)
      if (subscriptionRef.current.ndk?.subManager) {
        subscriptionRef.current.ndk.subManager.subscriptions.delete(
          subscriptionRef.current.internalId
        )
      }
      subscriptionRef.current = null
    }

    try {
      if (pubKeyHex) {
        const filter = {kinds: [3], authors: [pubKeyHex]}

        const sub = subscribe(filter, {closeOnEose: true})
        subscriptionRef.current = sub

        let latestTimestamp = 0

        sub?.on("event", (event: NostrEvent) => {
          // event.ndk = ndk() // TODO: adjust for applesauce compatibility
          socialGraph().handleEvent(event as NostrEvent)
          if (event && event.created_at && event.created_at > latestTimestamp) {
            latestTimestamp = event.created_at
            handleSocialGraphEvent(event as NostrEvent)
            const pubkeys = getMatchingTags(event, "p")
              .map((pTag) => pTag[1])
              .sort((a, b) => {
                return (
                  socialGraph().getFollowDistance(a) - socialGraph().getFollowDistance(b)
                )
              })
            if (includeSelf && pubKey) {
              pubkeys.unshift(pubKey)
            }
            setFollows(pubkeys)
          }
        })
      }
    } catch (error) {
      console.warn(error)
    }

    return () => {
      if (subscriptionRef.current) {
        subscriptionRef.current.stop()
        // Force cleanup by removing from subscription manager (NDK bug workaround)
        if (subscriptionRef.current.ndk?.subManager) {
          subscriptionRef.current.ndk.subManager.subscriptions.delete(
            subscriptionRef.current.internalId
          )
        }
        subscriptionRef.current = null
      }
    }
  }, [pubKeyHex, includeSelf, pubKey])

  return follows
}

export default useFollows
