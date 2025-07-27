import type {NostrEvent} from "nostr-tools"
import {subscribe as applesauceSubscribe} from "@/utils/applesauce"
import {handleProfile} from "@/utils/profileSearch"
import {PublicKey} from "@/shared/utils/PublicKey"
import {useEffect, useMemo, useState, useRef} from "react"
import {profileCache, addCachedProfile} from "@/utils/profileCache"

export default function useProfile(pubKey?: string, shouldSubscribe = true) {
  const pubKeyHex = useMemo(() => {
    if (!pubKey) {
      return ""
    }
    try {
      return new PublicKey(pubKey).toString()
    } catch (e) {
      console.warn(`Invalid pubkey: ${pubKey}`)
      return ""
    }
  }, [pubKey])

  const [profile, setProfile] = useState<Record<string, unknown> | null>(
    profileCache.get(pubKeyHex || "") || null
  )

  const subscriptionRef = useRef<{stop: () => void} | null>(null)

  useEffect(() => {
    // Clean up any existing subscription first
    if (subscriptionRef.current) {
      subscriptionRef.current.stop()
      subscriptionRef.current = null
    }

    if (!pubKeyHex) {
      return
    }

    const newProfile = profileCache.get(pubKeyHex || "") || null
    setProfile(newProfile)

    if (newProfile && !shouldSubscribe) {
      return
    }

    const sub = applesauceSubscribe(
      {kinds: [0], authors: [pubKeyHex]},
      {closeOnEose: true}
    )
    subscriptionRef.current = sub

    let latest = 0
    sub.on("event", (event: NostrEvent) => {
      if (event.pubkey === pubKeyHex && event.kind === 0) {
        if (!event.created_at || event.created_at <= latest) {
          return
        }
        latest = event.created_at
        const profile = JSON.parse(event.content)
        profile.created_at = event.created_at
        addCachedProfile(pubKeyHex, profile)
        setProfile(profile)
        handleProfile(pubKeyHex, profile)
      }
    })

    return () => {
      if (subscriptionRef.current) {
        subscriptionRef.current.stop()
        subscriptionRef.current = null
      }
    }
  }, [pubKeyHex, shouldSubscribe])

  return profile
}
