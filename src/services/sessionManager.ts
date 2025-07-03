/* eslint-disable @typescript-eslint/no-explicit-any */
import {StorageAdapter} from "nostr-double-ratchet/src/StorageAdapter"
import SessionManager from "nostr-double-ratchet/src/SessionManager"
import {usePrivateChatsStore} from "../stores/privateChats"
import {VerifiedEvent, Filter} from "nostr-tools"
import {useEventsStore} from "../stores/events"
import {NDKEvent} from "@nostr-dev-kit/ndk"
import {useUserStore} from "../stores/user"
import localforage from "localforage"
import {ndk} from "@/utils/ndk"

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

const makeSubscribe = () => (filter: Filter, onEvent: (event: VerifiedEvent) => void) => {
  const sub = ndk().subscribe(filter)
  sub.on("event", (e) => {
    console.log("got evt", e)
    onEvent(e as unknown as VerifiedEvent)
  })
  return () => sub.stop()
}

const makePublish = () => async (event: any) => {
  const ndkEvent = new NDKEvent(ndk())
  ndkEvent.kind = event.kind
  ndkEvent.content = event.content
  ndkEvent.tags = event.tags
  ndkEvent.created_at = event.created_at
  await ndkEvent.sign().then(() => {
    ndkEvent.publish(undefined, undefined, 0).catch((error) => {
      console.warn(`Event could not be published: ${error}`)
    })
  })
  console.log("ndkevent", ndkEvent)
  return ndkEvent
}

let manager: SessionManager | undefined
const messageCallbacks: Array<(publicKey: string, event: any) => void> = []

export const getDeviceId = (): string => {
  const stored = window.localStorage.getItem("deviceId")
  if (stored) return stored
  const newId = crypto.randomUUID()
  window.localStorage.setItem("deviceId", newId)
  return newId
}

/**
 * Initialize the session manager with user's identity key and device ID
 */
async function initializeManager(
  identityKey: Uint8Array,
  deviceId: string
): Promise<void> {
  if (manager) return

  const subscribe = makeSubscribe()
  const publish = makePublish()

  manager = new SessionManager(
    identityKey,
    deviceId,
    subscribe as unknown as any,
    publish as unknown as any,
    storage
  )

  await manager.init()

  manager.onEvent((rumor: any) => {
    console.log("got rumor", rumor)
    messageCallbacks.forEach((callback) => {
      callback("unknown-sender", rumor)
    })
  })
}

/**
 * Get the underlying SessionManager instance, initializing if needed
 */
export async function ensureManager(): Promise<SessionManager | undefined> {
  if (manager) return manager

  const publicKey = useUserStore.getState().publicKey
  if (!publicKey) return undefined

  const {hexToBytes} = await import("@noble/hashes/utils")
  const deviceId = getDeviceId()

  await initializeManager(hexToBytes(publicKey), deviceId)
  return manager
}

/**
 * Initialize a chat with a specific public key
 * Adds the contact to privateChats and starts listening for their messages
 */
export async function initializeChat(publicKeyHex: string): Promise<void> {
  console.log("Initialising chat", publicKeyHex)
  const sessionManager = await ensureManager()
  if (!sessionManager) {
    return
  }

  const {chatPublicKeys, addChat} = usePrivateChatsStore.getState()
  if (!chatPublicKeys.has(publicKeyHex)) {
    addChat(publicKeyHex)
  }

  sessionManager.listenToUser(publicKeyHex)
}

/**
 * Send a message to a specific public key
 */
export async function sendMessage(
  publicKey: string,
  content: string,
  replyToId?: string,
  isReaction = false
): Promise<void> {
  const sessionManager = await ensureManager()
  if (!sessionManager) {
    throw new Error("SessionManager not available")
  }

  try {
    let messageToStore: any
    let events: any[] = []

    if (!isReaction && !replyToId) {
      events = await (sessionManager as any).sendText(publicKey, content)

      const myPubKey = useUserStore.getState().publicKey
      messageToStore = {
        id: crypto.randomUUID(),
        content,
        kind: 1059,
        created_at: Math.floor(Date.now() / 1000),
        pubkey: myPubKey || "",
        sender: "user" as const,
        tags: [["ms", Date.now().toString()]],
      }
    } else {
      const event = {
        content,
        kind: isReaction ? 7 : 1059,
        tags: [...(replyToId ? [["e", replyToId]] : []), ["ms", Date.now().toString()]],
      }

      events = await (sessionManager as any).sendEvent(publicKey, event)

      const myPubKey = useUserStore.getState().publicKey
      messageToStore = {
        id: crypto.randomUUID(),
        content,
        kind: event.kind,
        created_at: Math.floor(Date.now() / 1000),
        pubkey: myPubKey || "",
        sender: "user" as const,
        tags: event.tags,
      }
    }

    console.log("sent msg events", events)

    if (events.length === 0) {
      sessionManager.listenToUser(publicKey)
    }

    if (messageToStore) {
      await useEventsStore.getState().upsert(publicKey, messageToStore)
    }
  } catch (error) {
    const myPubKey = useUserStore.getState().publicKey
    const messageToStore = {
      id: crypto.randomUUID(),
      content,
      kind: isReaction ? 7 : 1059,
      created_at: Math.floor(Date.now() / 1000),
      pubkey: myPubKey || "",
      sender: "user" as const,
      tags: replyToId
        ? [
            ["e", replyToId],
            ["ms", Date.now().toString()],
          ]
        : [["ms", Date.now().toString()]],
    }
    await useEventsStore.getState().upsert(publicKey, messageToStore)
    throw error
  }
}

/**
 * Register a callback for incoming messages
 */
export function onMessage(callback: (publicKey: string, event: any) => void): () => void {
  messageCallbacks.push(callback)

  return () => {
    const index = messageCallbacks.indexOf(callback)
    if (index > -1) {
      messageCallbacks.splice(index, 1)
    }
  }
}
