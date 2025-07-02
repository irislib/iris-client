import {NDKEvent, NDKUserProfile, NDKSubscription} from "@nostr-dev-kit/ndk"
import {handleProfile} from "./profileSearch"
import {profileCache} from "./memcache"
import {ndk} from "./ndk"

type ProfileSubscription = {
  subscription: NDKSubscription
  callbacks: Set<(profile: NDKUserProfile | null) => void>
  latest: number
}

class ProfileSubscriptionManager {
  private subscriptions = new Map<string, ProfileSubscription>()

  subscribe(pubKeyHex: string, callback: (profile: NDKUserProfile | null) => void) {
    if (!pubKeyHex) return () => {}

    let existing = this.subscriptions.get(pubKeyHex)

    if (!existing) {
      const sub = ndk().subscribe(
        {kinds: [0], authors: [pubKeyHex]},
        {closeOnEose: false}
      )
      let latest = 0

      existing = {
        subscription: sub,
        callbacks: new Set(),
        latest: 0,
      }

      sub.on("event", (event: NDKEvent) => {
        if (event.pubkey === pubKeyHex && event.kind === 0) {
          if (!event.created_at || event.created_at <= latest) {
            return
          }
          latest = event.created_at
          existing!.latest = latest

          const profile = JSON.parse(event.content)
          profile.created_at = event.created_at
          profileCache.set(pubKeyHex, profile)
          handleProfile(pubKeyHex, profile)

          existing!.callbacks.forEach((cb) => cb(profile))
        }
      })

      this.subscriptions.set(pubKeyHex, existing)
    }

    existing.callbacks.add(callback)

    const cachedProfile = profileCache.get(pubKeyHex)
    if (cachedProfile) {
      callback(cachedProfile)
    }

    return () => {
      const sub = this.subscriptions.get(pubKeyHex)
      if (sub) {
        sub.callbacks.delete(callback)
        if (sub.callbacks.size === 0) {
          sub.subscription.stop()
          this.subscriptions.delete(pubKeyHex)
        }
      }
    }
  }
}

export const profileSubscriptionManager = new ProfileSubscriptionManager()
