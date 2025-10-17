import {StorageAdapter} from "../StorageAdapter"
import {
  SESSION_MANAGER_VERSION,
  SESSION_MANAGER_VERSION_KEY,
  deviceInviteKey,
  inviteAcceptKey,
  userInviteKey,
  userRecordKey,
} from "../storageKeys"

type StoredSessionEntry = [string, unknown]

interface StoredDeviceRecordLegacy {
  deviceId: string
  activeSession: StoredSessionEntry | null
  inactiveSessions: StoredSessionEntry[]
}

interface StoredUserRecordLegacy {
  publicKey: string
  devices: StoredDeviceRecordLegacy[]
}

const LEGACY_USER_PREFIX = "user/"
const LEGACY_INVITE_PREFIX = "invite/"
const LEGACY_INVITE_ACCEPT_PREFIX = "invite-accept/"

const HEX_64_REGEX = /^[0-9a-f]{64}$/i

function isSerializedSessionEntry(entry: StoredSessionEntry): entry is [string, unknown] {
  return Array.isArray(entry) && entry.length === 2
}

export async function migrateToVersion1(storage: StorageAdapter): Promise<void> {
  const recordedVersion = await storage.get<string>(SESSION_MANAGER_VERSION_KEY)
  if (recordedVersion === SESSION_MANAGER_VERSION) {
    return
  }

  const legacyUserKeys = await storage.list(LEGACY_USER_PREFIX)

  await Promise.all(
    legacyUserKeys.map(async (legacyKey) => {
      const record = await storage.get<StoredUserRecordLegacy>(legacyKey)
      if (!record) return

      const migratedDevices = record.devices.map((device) => {
        if (device.activeSession && isSerializedSessionEntry(device.activeSession)) {
          return {
            deviceId: device.deviceId,
            activeSession: null,
            inactiveSessions: [device.activeSession, ...device.inactiveSessions],
          }
        }
        return device
      })

      const migratedRecord: StoredUserRecordLegacy = {
        publicKey: record.publicKey,
        devices: migratedDevices,
      }

      await storage.put(userRecordKey(record.publicKey), migratedRecord)
      await storage.del(legacyKey)
    })
  )

  const legacyInviteKeys = await storage.list(LEGACY_INVITE_PREFIX)

  await Promise.all(
    legacyInviteKeys.map(async (legacyKey) => {
      const value = await storage.get(legacyKey)
      if (value === undefined) return

      const suffix = legacyKey.substring(LEGACY_INVITE_PREFIX.length)

      const destinationKey = HEX_64_REGEX.test(suffix)
        ? userInviteKey(suffix)
        : deviceInviteKey(suffix)

      await storage.put(destinationKey, value)
      await storage.del(legacyKey)
    })
  )

  const legacyInviteAcceptKeys = await storage.list(LEGACY_INVITE_ACCEPT_PREFIX)

  await Promise.all(
    legacyInviteAcceptKeys.map(async (legacyKey) => {
      const value = await storage.get(legacyKey)
      if (value === undefined) return

      const suffix = legacyKey.substring(LEGACY_INVITE_ACCEPT_PREFIX.length)
      const parts = suffix.split("/")
      if (parts.length !== 3) return

      const [userPubkey, deviceId, nostrEventId] = parts
      await storage.put(inviteAcceptKey(nostrEventId, userPubkey, deviceId), value)
      await storage.del(legacyKey)
    })
  )

  // Any legacy session blobs should be cleared to avoid leaks
  const legacySessionKeys = await storage.list("session/")
  await Promise.all(legacySessionKeys.map((key) => storage.del(key)))

  await storage.put(SESSION_MANAGER_VERSION_KEY, SESSION_MANAGER_VERSION)
}

export async function migrateToVersion1IfNeeded(storage: StorageAdapter): Promise<void> {
  await migrateToVersion1(storage)
}
