import {
  useSocialGraph,
  handleSocialGraphEvent,
  socialGraphLoaded,
} from "@/utils/socialGraph.ts"
import {PublicKey} from "@/shared/utils/PublicKey"
import {useEffect, useState, useMemo} from "react"
import {NostrEvent} from "nostr-social-graph"
import {NDKEvent, NDKSubscription} from "@/lib/ndk"
import {ndk} from "@/utils/ndk"

const useFollows = (pubKey: string | null | undefined, includeSelf = false) => {
  const socialGraph = useSocialGraph()
  const pubKeyHex = useMemo(
    () => (pubKey ? new PublicKey(pubKey).toString() : ""),
    [pubKey]
  )
  const [follows, setFollows] = useState<string[] | undefined>(undefined)

  // Initialize follows when pubKeyHex changes
  useEffect(() => {
    if (pubKeyHex) {
      setFollows([...socialGraph.getFollowedByUser(pubKeyHex, includeSelf)])
    } else {
      setFollows([])
    }
  }, [pubKeyHex, includeSelf, socialGraph])

  useEffect(() => {
    if (!pubKeyHex) return

    let cancelled = false
    let subscription: NDKSubscription | null = null
    let latestTimestamp = 0

    const subscribe = async () => {
      await socialGraphLoaded
      if (cancelled) return

      subscription = ndk().subscribe(
        {kinds: [3], authors: [pubKeyHex]},
        {
          onEvent: (event: NDKEvent) => {
            event.ndk = ndk()
            if (event.created_at && event.created_at > latestTimestamp) {
              latestTimestamp = event.created_at
              handleSocialGraphEvent(event as NostrEvent)
              const pubkeys = event
                .getMatchingTags("p")
                .map((pTag) => pTag[1])
                .sort((a, b) => {
                  return (
                    socialGraph.getFollowDistance(a) - socialGraph.getFollowDistance(b)
                  )
                })
              if (includeSelf && pubKey) {
                pubkeys.unshift(pubKey)
              }
              setFollows(pubkeys)
            }
          },
        }
      )
    }
    void subscribe().catch((error) => console.warn(error))

    return () => {
      cancelled = true
      subscription?.stop()
    }
  }, [pubKeyHex, includeSelf, pubKey, socialGraph])

  return follows ?? []
}

export default useFollows
export {useFollows}
