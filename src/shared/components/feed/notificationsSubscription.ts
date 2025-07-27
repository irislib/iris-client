import {useSettingsStore} from "@/stores/settings"
import socialGraph from "@/utils/socialGraph"
import {shouldHideAuthor} from "@/utils/visibility"
import {getTag, getZappingUser} from "@/utils/nostr.ts"
import {notifications, Notification as IrisNotification} from "@/utils/notifications"
import {SortedMap} from "@/utils/SortedMap/SortedMap"
import {useNotificationsStore} from "@/stores/notifications"
import debounce from "lodash/debounce"
import {getPool, DEFAULT_RELAYS} from "@/utils/applesauce"
import {Subscription} from "rxjs"

let sub: Subscription | undefined

export const startNotificationsSubscription = debounce((myPubKey?: string) => {
  if (!myPubKey || typeof myPubKey !== "string") return

  sub?.unsubscribe()

  const kinds: number[] = [
    7, // reactions
    6, // reposts
    1, // replies
    9735, // zap receipts
    9802, // highlights
  ]

  const filters = {
    kinds: kinds,
    ["#p"]: [myPubKey],
    limit: 100,
  }

  const pool = getPool()
  const poolSubscription = pool.subscription(DEFAULT_RELAYS, filters)

  let latest = 0

  const settings = useSettingsStore.getState()
  const hideEventsByUnknownUsers = settings.content?.hideEventsByUnknownUsers

  sub = poolSubscription.subscribe({
    next: (event) => {
      if (typeof event === "string") return
      if (event.kind !== 9735) {
        // allow zap notifs from self & unknown users
        if (event.pubkey === myPubKey) return
        if (hideEventsByUnknownUsers && socialGraph().getFollowDistance(event.pubkey) > 5)
          return
        // Skip notifications from authors that should be hidden
        if (shouldHideAuthor(event.pubkey)) return
      } else {
        // For zap notifications, check the zapping user
        const zappingUser = getZappingUser(event)
        if (zappingUser && shouldHideAuthor(zappingUser)) return
      }
      const eTag = getTag("e", event.tags)
      if (eTag && event.created_at) {
        const key = `${eTag}-${event.kind}`

        const notification =
          notifications.get(key) ||
          ({
            id: event.id,
            originalEventId: eTag,
            users: new SortedMap([], "time"),
            kind: event.kind,
            time: event.created_at,
            content: event.content,
            tags: event.tags,
          } as IrisNotification)
        const user = event.kind === 9735 ? getZappingUser(event) : event.pubkey
        if (!user) {
          console.warn("no user for event", event)
          return
        }
        const existing = notification.users.get(user)
        if (!existing || existing.time < event.created_at) {
          notification.users.set(user, {
            time: event.created_at,
            content: event.kind === 7 ? event.content : undefined,
          })
        }
        if (event.created_at > notification.time) {
          notification.time = event.created_at
        }

        notifications.set(key, notification)

        if (event.created_at > latest) {
          latest = event.created_at
          useNotificationsStore.getState().setLatestNotification(event.created_at)
        }
      }
    },
    error: (error) => {
      console.error("Notifications subscription error:", error)
    },
  })
}, 500)
