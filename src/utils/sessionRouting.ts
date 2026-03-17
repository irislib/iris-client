import type {DeviceEntry} from "nostr-double-ratchet"

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
  appKeys?: {
    getAllDevices?: () => Array<{
      identityPubkey?: string | null
    }>
  } | null
}

export type SessionUserRecordsLike = Map<string, SessionUserRecordLike>

export function isOwnDevicePubkey(
  pubkey: string,
  ownerPubkey: string,
  identityPubkey: string | null,
  devices: DeviceEntry[]
): boolean {
  if (!pubkey) return false
  if (pubkey === ownerPubkey) return true
  if (identityPubkey && pubkey === identityPubkey) return true
  return devices.some((device) => device.identityPubkey === pubkey)
}

export function isOwnDeviceEvent(
  eventPubkey: string,
  sessionPubkey: string,
  ownerPubkey: string,
  identityPubkey: string | null,
  devices: DeviceEntry[]
): boolean {
  return (
    isOwnDevicePubkey(eventPubkey, ownerPubkey, identityPubkey, devices) ||
    isOwnDevicePubkey(sessionPubkey, ownerPubkey, identityPubkey, devices)
  )
}

export function hasExistingSessionWithRecipient(
  userRecords: SessionUserRecordsLike | null | undefined,
  recipientPubkey: string
): boolean {
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
          state.theirCurrentNostrPublicKey === recipientPubkey ||
          state.theirNextNostrPublicKey === recipientPubkey
        ) {
          return true
        }
      }
    }
  }

  return false
}

export function resolveSessionPubkeyToOwner(
  userRecords: SessionUserRecordsLike | null | undefined,
  pubkey: string
): string {
  if (!userRecords || !pubkey) return pubkey

  for (const [recordPubkey, userRecord] of userRecords.entries()) {
    if (recordPubkey === pubkey) {
      return recordPubkey
    }

    const devices = userRecord?.devices
    if (devices?.has(pubkey)) {
      return recordPubkey
    }

    const appKeyDevices = userRecord?.appKeys?.getAllDevices?.() ?? []
    if (appKeyDevices.some((device) => device.identityPubkey === pubkey)) {
      return recordPubkey
    }

    if (!devices) continue

    for (const device of devices.values()) {
      const sessions = [device.activeSession, ...(device.inactiveSessions ?? [])]
      for (const session of sessions) {
        if (!session) continue
        const state = session.state
        if (!state) continue

        if (
          state.theirCurrentNostrPublicKey === pubkey ||
          state.theirNextNostrPublicKey === pubkey
        ) {
          return recordPubkey
        }
      }
    }
  }

  return pubkey
}
