import {profileSubscriptionManager} from "@/utils/profileSubscriptionManager"
import {PublicKey} from "@/shared/utils/PublicKey"
import {useEffect, useMemo, useState} from "react"
import {NDKUserProfile} from "@nostr-dev-kit/ndk"
import {profileCache} from "@/utils/memcache"

export default function useProfile(pubKey?: string, subscribe = true) {
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

  const [profile, setProfile] = useState<NDKUserProfile | null>(
    profileCache.get(pubKeyHex || "") || null
  )

  useEffect(() => {
    if (!pubKeyHex) {
      setProfile(null)
      return
    }

    const cachedProfile = profileCache.get(pubKeyHex)
    setProfile(cachedProfile || null)

    if (!subscribe) {
      return
    }

    return profileSubscriptionManager.subscribe(pubKeyHex, setProfile)
  }, [pubKeyHex, subscribe])

  return profile
}
