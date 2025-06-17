/* eslint-disable @typescript-eslint/no-explicit-any */
import {StorageAdapter} from "nostr-double-ratchet/src/StorageAdapter"
import SessionManager from "nostr-double-ratchet/src/SessionManager"
import {VerifiedEvent, Filter} from "nostr-tools"
import {Session} from "nostr-double-ratchet/src"
import localforage from "localforage"
import {useUserStore} from "./user"
import {ndk} from "@/utils/ndk"
import {create} from "zustand"

// localforage storage adapter
const storage: StorageAdapter = {
  get: async (key) => {
    return (await localforage.getItem(key)) ?? undefined
  },
  put: async (key, value) => {
    await localforage.setItem(key, value)
  },
  del: async (key) => {
    await localforage.removeItem(key)
  },
  list: async (prefix) => {
    const keys: string[] = []
    await localforage.iterate((_value, key) => {
      if (!prefix || key.startsWith(prefix)) keys.push(key)
    })
    return keys
  },
}

// Type of the wrapper state
export interface SessionManagerState {
  manager?: SessionManager
  ready: boolean
  tick: number
  init: (identityKey: Uint8Array, deviceId: string) => Promise<void>
  getSessions: () => Map<string, Session>
  getChatUsers: () => string[]
  getManager: () => Promise<SessionManager | undefined>
}

// Nostr subscribe helper for SessionManager
const makeSubscribe = () => (filter: Filter, onEvent: (event: VerifiedEvent) => void) => {
  const sub = ndk().subscribe(filter)
  sub.on("event", (e) => onEvent(e as unknown as VerifiedEvent))
  return () => sub.stop()
}

const makePublish = () => (event: any) => {
  try {
    return ndk().publish(event) as unknown as Promise<void>
  } catch (e) {
    console.warn("Failed to publish event", e)
    return undefined
  }
}

export const useSessionManager = create<SessionManagerState>()((set, get) => ({
  manager: undefined,
  ready: false,
  tick: 0,
  getSessions: () => {
    const mgr = get().manager
    if (!mgr) return new Map()
    const sessionsMap = new Map<string, Session>()
    const userRecords = (mgr as any).userRecords as Map<string, any>
    userRecords?.forEach((record: any, pubkey: string) => {
      const active: Session[] = record.getActiveSessions()
      active.forEach((s: Session) => {
        sessionsMap.set(`${pubkey}:${s.name}`, s)
      })
    })
    return sessionsMap
  },
  getChatUsers: () => {
    const mgr = get().manager
    if (!mgr) return [] as string[]

    const userRecords = (mgr as any).userRecords as Map<string, any>
    return Array.from(userRecords.keys())
  },
  init: async (identityKey: Uint8Array, deviceId: string) => {
    if (get().manager) return // already initialised

    const subscribe = makeSubscribe()
    const publish = makePublish()

    // Cast to any to avoid potential type mismatches arising from duplicate nostr-tools versions
    const mgr = new SessionManager(
      identityKey,
      deviceId,
      subscribe as unknown as any,
      publish as unknown as any,
      storage
    )
    // Ensure internal async init finishes before marking ready
    await mgr.init()
    set({manager: mgr, ready: true})

    // Listen to events to update tick for React subscriptions
    mgr.onEvent(() => {
      set((state) => ({tick: state.tick + 1}))
    })
  },
  getManager: async () => {
    const mgr = get().manager
    if (mgr) return mgr
    // Try to initialise if keys are present
    const publicKey = useUserStore.getState().publicKey
    if (!publicKey) return undefined
    const {hexToBytes} = await import("@noble/hashes/utils")
    const deviceId = (() => {
      const stored = window.localStorage.getItem("deviceId")
      if (stored) return stored
      const newId = `web-${crypto.randomUUID()}`
      window.localStorage.setItem("deviceId", newId)
      return newId
    })()
    await get().init(hexToBytes(publicKey), deviceId)
    return get().manager
  },
}))
