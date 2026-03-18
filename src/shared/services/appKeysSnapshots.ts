import {AppKeys, applyAppKeysSnapshot, buildAppKeysFilter, NostrSubscribe} from "nostr-double-ratchet"

export interface AppKeysSnapshot {
  appKeys: AppKeys
  createdAt: number
}

export const waitForLatestAppKeysSnapshot = (
  ownerPubkey: string,
  subscribe: NostrSubscribe,
  timeoutMs: number
): Promise<AppKeysSnapshot | null> => {
  return new Promise((resolve) => {
    let latest: AppKeysSnapshot | null = null

    const unsubscribe = subscribe(buildAppKeysFilter(ownerPubkey), (event) => {
      if (event.pubkey !== ownerPubkey) {
        return
      }

      try {
        const incomingAppKeys = AppKeys.fromEvent(event)
        const nextSnapshot = applyAppKeysSnapshot({
          currentAppKeys: latest?.appKeys,
          currentCreatedAt: latest?.createdAt,
          incomingAppKeys,
          incomingCreatedAt: event.created_at,
        })
        if (nextSnapshot.decision === "stale") {
          return
        }

        latest = {
          appKeys: nextSnapshot.appKeys,
          createdAt: nextSnapshot.createdAt,
        }
      } catch {
        // Ignore invalid AppKeys events.
      }
    })

    setTimeout(() => {
      unsubscribe()
      resolve(latest)
    }, timeoutMs)
  })
}
