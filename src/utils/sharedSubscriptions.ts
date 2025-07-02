import {NDKEvent, NDKFilter} from "@nostr-dev-kit/ndk"
import {shouldHideAuthor} from "@/utils/visibility"
import {ndk} from "@/utils/ndk"
import debounce from "lodash/debounce"

type SubscriptionCallback = (event: NDKEvent) => void
type SubscriptionKey = string

class SharedSubscriptionManager {
  private subscriptions = new Map<SubscriptionKey, {
    sub: any
    callbacks: Set<SubscriptionCallback>
    filter: NDKFilter
  }>()

  private getSubscriptionKey(filter: NDKFilter): SubscriptionKey {
    return JSON.stringify(filter)
  }

  subscribe(filter: NDKFilter, callback: SubscriptionCallback): () => void {
    const key = this.getSubscriptionKey(filter)
    let subscription = this.subscriptions.get(key)

    if (!subscription) {
      const sub = ndk().subscribe(filter)
      subscription = {
        sub,
        callbacks: new Set(),
        filter
      }

      sub.on("event", (event: NDKEvent) => {
        if (shouldHideAuthor(event.author.pubkey)) return
        
        subscription!.callbacks.forEach(cb => {
          try {
            cb(event)
          } catch (error) {
            console.warn("Error in subscription callback:", error)
          }
        })
      })

      this.subscriptions.set(key, subscription)
    }

    subscription.callbacks.add(callback)

    return () => {
      const sub = this.subscriptions.get(key)
      if (sub) {
        sub.callbacks.delete(callback)
        if (sub.callbacks.size === 0) {
          sub.sub.stop()
          this.subscriptions.delete(key)
        }
      }
    }
  }

  subscribeToReactions(eventIds: string[], kind: number, callback: SubscriptionCallback): () => void {
    const filter = {
      kinds: [kind],
      ["#e"]: eventIds,
    }
    return this.subscribe(filter, callback)
  }
}

export const sharedSubscriptionManager = new SharedSubscriptionManager()

export const createBatchedReactionUpdater = <T>(
  updateFn: (updates: Map<string, T>) => void,
  delay = 100
) => {
  const pendingUpdates = new Map<string, T>()
  
  const debouncedUpdate = debounce(() => {
    if (pendingUpdates.size > 0) {
      updateFn(new Map(pendingUpdates))
      pendingUpdates.clear()
    }
  }, delay)

  return (eventId: string, update: T) => {
    pendingUpdates.set(eventId, update)
    debouncedUpdate()
  }
}
