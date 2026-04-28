import localforage from "localforage"
import {
  deserializeSessionState,
  REACTION_KIND,
  RECEIPT_KIND,
  Rumor,
  Session,
  TYPING_KIND,
} from "nostr-double-ratchet"
import type {VerifiedEvent} from "nostr-tools"

type LocalForageInstance = typeof localforage

export const SESSION_STORAGE_CONFIG = {
  name: "iris-session-manager",
  storeName: "session-private",
} as const

export const SESSION_STORAGE_PREFIX = "private"
export const USER_RECORD_PREFIX = "v1/user/"

export function createSessionStorage(
  config: typeof SESSION_STORAGE_CONFIG = SESSION_STORAGE_CONFIG
) {
  return localforage.createInstance(config)
}

interface StoredSessionEntry {
  name: string
  state: string
}

interface StoredDeviceRecord {
  deviceId: string
  activeSession: StoredSessionEntry | null
  inactiveSessions: StoredSessionEntry[]
  staleAt?: number
}

interface StoredUserRecord {
  publicKey: string
  devices: StoredDeviceRecord[]
}

export interface StoredSessionState {
  sessionId: string
  serializedState: string
  userPublicKey: string
}

export type DmPushDecryptResult =
  | {success: false}
  | {
      success: true
      kind: number
      content: string
      sessionId: string
      userPublicKey: string
      silent: boolean
    }

export async function fetchStoredSessions(
  storage: LocalForageInstance,
  keyPrefix: string = SESSION_STORAGE_PREFIX
): Promise<StoredSessionState[]> {
  try {
    const keys = await storage.keys()
    const userRecordKeys = keys.filter((key) =>
      key.startsWith(`${keyPrefix}${USER_RECORD_PREFIX}`)
    )

    const userRecords = await Promise.all(
      userRecordKeys.map((key) => storage.getItem<StoredUserRecord>(key))
    ).then((userRecords) =>
      userRecords.filter((ur): ur is StoredUserRecord => ur !== null)
    )

    const sessions: StoredSessionState[] = userRecords.flatMap((record) =>
      record.devices
        .filter((device) => device.staleAt === undefined)
        .flatMap((device) => {
          const sessions = device.activeSession
            ? [device.activeSession, ...device.inactiveSessions]
            : device.inactiveSessions

          return sessions.map((entry) => ({
            sessionId: record.publicKey,
            serializedState: entry.state,
            userPublicKey: record.publicKey,
          }))
        })
    )

    return sessions
  } catch {
    return []
  }
}

export async function tryDecryptDmPushEvent(
  outerEvent: VerifiedEvent,
  opts: {
    storage: LocalForageInstance
    timeoutMs?: number
    keyPrefix?: string
  }
): Promise<DmPushDecryptResult> {
  const {storage, timeoutMs = 1500, keyPrefix = SESSION_STORAGE_PREFIX} = opts

  try {
    const sessionEntries = await fetchStoredSessions(storage, keyPrefix)

    const matchingSessions = sessionEntries.filter(({serializedState}) => {
      try {
        const state = deserializeSessionState(serializedState)
        return (
          state.theirCurrentNostrPublicKey === outerEvent.pubkey ||
          state.theirNextNostrPublicKey === outerEvent.pubkey
        )
      } catch {
        return false
      }
    })

    if (matchingSessions.length === 0) {
      return {success: false}
    }

    const eventForSession: VerifiedEvent = {
      ...(outerEvent as unknown as VerifiedEvent),
      tags: outerEvent.tags.filter(([key]) => key === "header"),
    }

    for (const entry of matchingSessions) {
      const state = deserializeSessionState(entry.serializedState)

      let unsubscribe: (() => void) | undefined
      const innerEvent = await new Promise<Rumor | null>((resolve) => {
        const session = new Session(state)
        const timeout = setTimeout(() => resolve(null), timeoutMs)
        unsubscribe = session.onEvent((event) => {
          clearTimeout(timeout)
          resolve(event)
        })
        try {
          const received = session.receiveEvent(eventForSession)
          if (!received) {
            clearTimeout(timeout)
            resolve(null)
          }
        } catch {
          clearTimeout(timeout)
          resolve(null)
        }
      })

      unsubscribe?.()

      if (innerEvent) {
        const {sessionId, userPublicKey} = entry
        const silent = innerEvent.kind === RECEIPT_KIND || innerEvent.kind === TYPING_KIND
        const content =
          innerEvent.kind === REACTION_KIND
            ? `Reacted ${innerEvent.content}`
            : innerEvent.content

        return {
          success: true,
          kind: innerEvent.kind,
          content,
          sessionId,
          userPublicKey,
          silent,
        }
      }
    }

    return {success: false}
  } catch {
    return {success: false}
  }
}
