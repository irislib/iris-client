import {usePrivateMessagesStore} from "@/stores/privateMessages"
import {getExpirationTimestampSeconds} from "nostr-double-ratchet"

let started = false
let timeoutId: number | null = null

/**
 * Periodically removes messages that have passed their NIP-40 expiration time.
 * This keeps chat lists, unread counts, and message panes consistent while the app is open.
 */
export function startMessageExpirationCleanup(): void {
  if (started) return
  started = true

  const tick = () => {
    const nowSeconds = Math.floor(Date.now() / 1000)

    // Purge first so next scheduling doesn't consider already-expired messages.
    usePrivateMessagesStore.getState().purgeExpired(nowSeconds)

    let nextExpirationSeconds: number | undefined
    const {events} = usePrivateMessagesStore.getState()
    for (const [, messageMap] of events.entries()) {
      for (const [, message] of messageMap.entries()) {
        const exp = getExpirationTimestampSeconds(message)
        if (exp === undefined) continue
        if (exp <= nowSeconds) continue
        nextExpirationSeconds =
          nextExpirationSeconds === undefined ? exp : Math.min(nextExpirationSeconds, exp)
      }
    }

    // Schedule close to the next expiration, but cap so time drift doesn't delay cleanup.
    const delayMs =
      nextExpirationSeconds === undefined
        ? 60_000
        : Math.max(1000, Math.min(60_000, (nextExpirationSeconds - nowSeconds) * 1000))

    timeoutId = window.setTimeout(tick, delayMs)
  }

  // Wait for messages to hydrate before the first scan.
  usePrivateMessagesStore.getState().awaitHydration().then(tick).catch(() => {})
}

export function stopMessageExpirationCleanup(): void {
  if (timeoutId !== null) {
    clearTimeout(timeoutId)
    timeoutId = null
  }
}
