import {
  useSocialGraph,
  handleSocialGraphEvent,
  socialGraphLoaded,
} from "@/utils/socialGraph.ts"
import {PublicKey} from "@/shared/utils/PublicKey"
import {useEffect, useMemo, useState} from "react"
import {NostrEvent} from "nostr-social-graph"
import {AppEvent, EventSubscription} from "@/lib/nostr"
import {nostr} from "@/utils/nostrClient"

const useFollows = (pubKey: string | null | undefined, includeSelf = false) => {
  const socialGraph = useSocialGraph()
  const pubKeyHex = useMemo(
    () => (pubKey ? new PublicKey(pubKey).toString() : ""),
    [pubKey]
  )
  const graphFollowsKey = pubKeyHex
    ? [...socialGraph.getFollowedByUser(pubKeyHex, includeSelf)]
        .sort(
          (a, b) => socialGraph.getFollowDistance(a) - socialGraph.getFollowDistance(b)
        )
        .join(",")
    : ""
  // Explicit profiles may be outside the graph's crawl distance. Retain their
  // received lists as well as graph updates, without resetting on unrelated
  // graph revisions or changing array identity when the list is unchanged.
  const [received, setReceived] = useState({pubkey: pubKeyHex, key: graphFollowsKey})
  useEffect(() => {
    setReceived({pubkey: pubKeyHex, key: graphFollowsKey})
  }, [pubKeyHex, graphFollowsKey])
  const followsKey = received.pubkey === pubKeyHex ? received.key : graphFollowsKey
  const follows = useMemo(() => (followsKey ? followsKey.split(",") : []), [followsKey])

  useEffect(() => {
    if (!pubKeyHex) return

    let cancelled = false
    let subscription: EventSubscription | null = null
    let latestTimestamp = 0

    const subscribe = async () => {
      await socialGraphLoaded
      if (cancelled) return

      subscription = nostr().subscribe({kinds: [3], authors: [pubKeyHex]})
      subscription.on("event", (event: AppEvent) => {
        if (event.created_at <= latestTimestamp) return
        latestTimestamp = event.created_at
        handleSocialGraphEvent(event as NostrEvent)
        const pubkeys = event.getMatchingTags("p").map((tag) => tag[1])
        if (includeSelf) pubkeys.unshift(pubKeyHex)
        pubkeys.sort(
          (a, b) => socialGraph.getFollowDistance(a) - socialGraph.getFollowDistance(b)
        )
        setReceived({pubkey: pubKeyHex, key: [...new Set(pubkeys)].join(",")})
      })
    }
    void subscribe().catch((error) => console.warn(error))

    return () => {
      cancelled = true
      subscription?.stop()
    }
  }, [pubKeyHex, includeSelf, socialGraph])

  return follows
}

export default useFollows
export {useFollows}
