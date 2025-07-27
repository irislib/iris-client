import socialGraph, {handleSocialGraphEvent} from "@/utils/socialGraph.ts"
import {PublicKey} from "@/shared/utils/PublicKey"
import {useEffect, useState, useMemo, useRef} from "react"
import {NostrEvent} from "nostr-social-graph"
import {getPool, DEFAULT_RELAYS} from "@/utils/applesauce"
import {Subscription} from "rxjs"

const useMutes = (pubKey?: string) => {
  const pubKeyHex = useMemo(
    () => (pubKey ? new PublicKey(pubKey).toString() : socialGraph().getRoot()),
    [pubKey]
  )
  const [mutes, setMutes] = useState<string[]>([
    ...socialGraph().getMutedByUser(pubKeyHex),
  ])
  const subscriptionRef = useRef<Subscription | null>(null)

  useEffect(() => {
    // Clean up any existing subscription first
    if (subscriptionRef.current) {
      subscriptionRef.current.unsubscribe()
      subscriptionRef.current = null
    }

    try {
      if (pubKeyHex) {
        const filter = {kinds: [10000], authors: [pubKeyHex]}

        const pool = getPool()
        const poolSubscription = pool.subscription(DEFAULT_RELAYS, filter)

        let latestTimestamp = 0

        const subscription = poolSubscription.subscribe({
          next: (event) => {
            if (
              typeof event !== "string" &&
              event &&
              event.created_at &&
              event.created_at > latestTimestamp
            ) {
              console.log(
                `Mute event received: ${event.kind} ${event.pubkey} ${event.created_at}`
              )
              latestTimestamp = event.created_at
              socialGraph().handleEvent(event as NostrEvent)
              handleSocialGraphEvent(event as NostrEvent)
              const pubkeys = event.tags
                .filter((tag) => tag[0] === "p")
                .map((pTag) => pTag[1])
                .sort((a, b) => {
                  return (
                    socialGraph().getFollowDistance(a) -
                    socialGraph().getFollowDistance(b)
                  )
                })
              setMutes(pubkeys)
            }
          },
          error: (error) => {
            console.error("Subscription error:", error)
          },
        })

        subscriptionRef.current = subscription
      }
    } catch (error) {
      console.warn(error)
    }

    return () => {
      if (subscriptionRef.current) {
        subscriptionRef.current.unsubscribe()
        subscriptionRef.current = null
      }
    }
  }, [pubKeyHex])

  return mutes
}

export default useMutes
