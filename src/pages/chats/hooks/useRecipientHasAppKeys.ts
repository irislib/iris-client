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

export const computeTimeoutFallbackHasAppKeys = (
  current: boolean | null,
  hasExistingSession: boolean
): boolean => {
  if (current !== null) {
    return current
  }
  return hasExistingSession
}

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
 * Returns null while checking, true if they have app keys, false if not.
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
        // Ignore async init errors and rely on AppKeys subscription / timeout fallback.
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

    // Set to false after timeout if no response
    const timeout = setTimeout(() => {
      setHasAppKeys((current) =>
        computeTimeoutFallbackHasAppKeys(current, hasExistingSession)
      )
    }, 3000)

    return () => {
      disposed = true
      unsubscribe()
      clearTimeout(timeout)
    }
  }, [recipientPubkey, myPubkey, hasLocalAppKeys, isCurrentDeviceRegistered])

  return {hasAppKeys}
}
