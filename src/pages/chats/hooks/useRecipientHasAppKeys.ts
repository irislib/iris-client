import {useEffect, useState} from "react"
import {AppKeys} from "nostr-double-ratchet"
import {
  ensureSessionManager,
  getNostrSubscribe,
  getSessionManager,
} from "@/shared/services/PrivateChats"
import {useUserStore} from "@/stores/user"
import {useDevicesStore} from "@/stores/devices"

type SessionStateLike = {
  theirCurrentNostrPublicKey?: string
  theirNextNostrPublicKey?: string
}

type SessionLike = {
  state?: SessionStateLike | null
}

type SessionDeviceLike = {
  activeSession?: SessionLike | null
  inactiveSessions?: Array<SessionLike | null>
}

type SessionUserRecordLike = {
  devices?: Map<string, SessionDeviceLike>
}

type SessionUserRecordsLike = Map<string, SessionUserRecordLike>

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

export const hasExistingSessionWithRecipient = (
  userRecords: SessionUserRecordsLike | null | undefined,
  recipientPubkey: string
): boolean => {
  if (!userRecords || !recipientPubkey) return false

  for (const [recordPubkey, userRecord] of userRecords.entries()) {
    const devices = userRecord?.devices
    if (!devices) continue

    for (const device of devices.values()) {
      const sessions = [device.activeSession, ...(device.inactiveSessions ?? [])]
      for (const session of sessions) {
        if (!session) continue
        const state = session.state
        if (!state) continue

        if (
          recordPubkey === recipientPubkey ||
          state?.theirCurrentNostrPublicKey === recipientPubkey ||
          state?.theirNextNostrPublicKey === recipientPubkey
        ) {
          return true
        }
      }
    }
  }

  return false
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
      const sessionManager = getSessionManager()
      if (sessionManager) {
        hasExistingSession = hasExistingSessionWithRecipient(
          sessionManager.getUserRecords() as SessionUserRecordsLike,
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
        const sessionManager = await ensureSessionManager(myPubkey)
        if (disposed) return

        hasExistingSession = hasExistingSessionWithRecipient(
          sessionManager.getUserRecords() as SessionUserRecordsLike,
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
