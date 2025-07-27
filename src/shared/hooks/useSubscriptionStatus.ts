import {useEffect, useState, useCallback} from "react"
import {LRUCache} from "typescript-lru-cache"
import {CONFIG} from "@/utils/config"

// Cache interface for subscription data
interface SubscriptionCache {
  data: {
    isSubscriber: boolean
    tier: "patron" | "champion" | "vanguard" | undefined
    endDate: string | undefined
  }
}

// Cache with max 100 entries
const subscriptionCache = new LRUCache<string, SubscriptionCache>({
  maxSize: 100,
})

// Function to invalidate cache for a specific pubkey
export const invalidateSubscriptionCache = (pubkey: string) => {
  subscriptionCache.delete(pubkey)
}

/**
 * Hook to check if a user is a subscriber based on their pubkey
 * @param pubkey The user's public key
 * @returns An object containing the subscription status, loading state, tier, and refresh function
 */
export function useSubscriptionStatus(pubkey?: string) {
  const [isSubscriber, setIsSubscriber] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [tier, setTier] = useState<"patron" | "champion" | "vanguard" | undefined>(
    undefined
  )
  const [endDate, setEndDate] = useState<string | undefined>(undefined)
  const [refreshCounter, setRefreshCounter] = useState(0)

  const checkSubscriberStatus = useCallback(async () => {
    if (!pubkey) {
      setIsLoading(false)
      return
    }

    // Check cache first
    const cached = subscriptionCache.get(pubkey)
    if (cached) {
      setIsSubscriber(cached.data.isSubscriber)
      setTier(cached.data.tier)
      setEndDate(cached.data.endDate)
      setIsLoading(false)
      return
    }

    try {
      setIsLoading(true)
      // Fetch the user data to check for subscription status
      const response = await fetch(
        `${CONFIG.defaultSettings.irisApiUrl}/user/find?public_key=${pubkey}`
      )
      if (response.ok) {
        const data = await response.json()
        const hasSubscription = !!data.subscription_plan
        setIsSubscriber(hasSubscription)
        setEndDate(data.subscription_end_date)

        // Set the tier based on the subscription plan
        let newTier: "patron" | "champion" | "vanguard" | undefined = undefined
        if (hasSubscription) {
          // The plan name comes directly from the database
          const planName = data.subscription_plan.toLowerCase()
          if (planName.includes("vanguard")) {
            newTier = "vanguard"
          } else if (planName.includes("champion")) {
            newTier = "champion"
          } else {
            newTier = "patron"
          }
        }
        setTier(newTier)

        // Update cache
        subscriptionCache.set(pubkey, {
          data: {
            isSubscriber: hasSubscription,
            tier: newTier,
            endDate: data.subscription_end_date,
          },
        })
      }
    } catch (error) {
      console.error("Error checking subscriber status:", error)
    } finally {
      setIsLoading(false)
    }
  }, [pubkey])

  const refresh = useCallback(() => {
    if (pubkey) {
      invalidateSubscriptionCache(pubkey) // Use the exported function
    }
    setRefreshCounter((c) => c + 1)
  }, [pubkey])

  useEffect(() => {
    checkSubscriberStatus()
  }, [checkSubscriberStatus, pubkey, refreshCounter])

  return {
    isSubscriber,
    isLoading,
    tier,
    endDate,
    refresh,
  }
}
