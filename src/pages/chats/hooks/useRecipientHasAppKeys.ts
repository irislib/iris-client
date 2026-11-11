import {useEffect, useState} from "react"
import {AppKeys} from "nostr-double-ratchet"
import {
  ensureNdrRuntime,
  getNostrSubscribe,
  getNdrRuntime,
} from "@/shared/services/PrivateChats"
import {useUserStore} from "@/stores/user"
import {useDevicesStore} from "@/stores/devices"
import {
  hasExistingSessionWithRecipient,
  type SessionUserRecordsLike,
} from "@/utils/sessionRouting"

export const applySessionFallbackHasAppKeys = (
  current: boolean | null,
  hasExistingSession: boolean
): boolean | null => {
  if (current !== null) {
    return current
  }
  return hasExistingSession ? true : null
}

/**
 * Hook to check if a recipient has set up encrypted messaging (has AppKeys).
 * Returns null while unknown, true if they have app keys, false once they publish none.
 */
export const useRecipientHasAppKeys = (
  recipientPubkey: string | undefined
): {hasAppKeys: boolean | null} => {
  const [hasAppKeys, setHasAppKeys] = useState<boolean | null>(null)
  const myPubkey = useUserStore((state) => state.publicKey)
  const {hasLocalAppKeys, isCurrentDeviceRegistered} = useDevicesStore()

  useEffect(() => {
    if (!recipientPubkey) {
      setHasAppKeys(null)
      return
    }

    if (recipientPubkey === myPubkey && (hasLocalAppKeys || isCurrentDeviceRegistered)) {
      setHasAppKeys(true)
      return
    }

    let disposed = false
    let hasExistingSession = false

    try {
      const runtime = getNdrRuntime()
      if (runtime.getState().sessionManagerReady) {
        hasExistingSession = hasExistingSessionWithRecipient(
          runtime.getSessionUserRecords() as SessionUserRecordsLike,
          recipientPubkey
        )
      }
    } catch {
      // Ignore local session lookup issues and fall back to async check below.
    }

    // Existing session is optimistic fallback, but explicit AppKeys response overrides this.
    setHasAppKeys(hasExistingSession ? true : null)

    void (async () => {
      if (!myPubkey) return

      try {
        const runtime = await ensureNdrRuntime(myPubkey)
        if (disposed) return

        hasExistingSession = hasExistingSessionWithRecipient(
          runtime.getSessionUserRecords() as SessionUserRecordsLike,
          recipientPubkey
        )
        setHasAppKeys((current) =>
          applySessionFallbackHasAppKeys(current, hasExistingSession)
        )
      } catch {
        // Ignore async init errors and rely on the AppKeys subscription.
      }
    })()

    const unsubscribe = AppKeys.fromUser(
      recipientPubkey,
      getNostrSubscribe(),
      (appKeys) => {
        const devices = appKeys.getAllDevices()
        setHasAppKeys(devices.length > 0)
      }
    )

    // Relay silence is not an answer: only an AppKeys event listing no devices
    // says the recipient cannot be reached, so the composer stays usable meanwhile.
    return () => {
      disposed = true
      unsubscribe()
    }
  }, [recipientPubkey, myPubkey, hasLocalAppKeys, isCurrentDeviceRegistered])

  return {hasAppKeys}
}
