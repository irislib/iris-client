import SessionManager from "../../session/SessionManager"
import {VerifiedEvent} from "nostr-tools"
import {LocalStorageAdapter} from "../../session/StorageAdapter"
import {NostrPublish, NostrSubscribe} from "nostr-double-ratchet"
import NDK, {NDKEvent, NDKFilter} from "@nostr-dev-kit/ndk"
import {ndk} from "@/utils/ndk"
import {useUserStore} from "../../stores/user"
import {hexToBytes} from "nostr-tools/utils"

const createSubscribe = (ndk: NDK): NostrSubscribe => {
  return (filter: NDKFilter, onEvent: (event: VerifiedEvent) => void) => {
    const subscription = ndk.subscribe(filter)

    subscription.on("event", (event: NDKEvent) => {
      console.warn("PrivateChats received event:", event.kind, event.id)
      onEvent(event as unknown as VerifiedEvent)
    })

    subscription.start()

    return () => {
      subscription.stop()
    }
  }
}

// NDK-compatible publish function - TODO: remove "as" by handling nostr-tools version mismatch between lib and app
const createPublish = (ndk: NDK): NostrPublish => {
  return (async (event) => {
    const e = new NDKEvent(ndk, event)
    console.warn("PrivateChats publishing event:", e)
    await e.publish()
    console.warn("PrivateChats published event:", e.kind, e.id, e.sig)
    return event
  }) as NostrPublish
}

const getOrCreateDeviceId = (): string => {
  let deviceId = localStorage.getItem("deviceId")
  if (!deviceId) {
    deviceId =
      Math.random().toString(36).substring(2, 15) +
      Math.random().toString(36).substring(2, 15)
    localStorage.setItem("deviceId", deviceId)
  }
  return deviceId
}

let manager: SessionManager | null = null

export const getSessionManager = (): SessionManager | null => {
  if (manager) return manager

  try {
    const {publicKey, privateKey} = useUserStore.getState()

    const encrypt = privateKey
      ? hexToBytes(privateKey)
      : async (plaintext: string, pubkey: string) => {
          if (window.nostr?.nip44) {
            return window.nostr.nip44.encrypt(pubkey, plaintext)
          }
          throw new Error("No nostr extension or private key")
        }

    const ndkInstance = ndk()

    manager = new SessionManager(
      publicKey,
      encrypt,
      getOrCreateDeviceId(),
      createSubscribe(ndkInstance),
      createPublish(ndkInstance),
      new LocalStorageAdapter("private")
    )

    return manager
  } catch (error) {
    console.error("Failed to create session manager:", error)
    return null
  }
}

/**
 * Publishes a tombstone event to nullify a device's chat invite
 * Makes the invite invisible to other devices
 */
export const deleteDeviceInvite = async (deviceId: string) => {
  const {publicKey} = useUserStore.getState()

  // Publish tombstone event - same kind and d tag, empty content
  const dTag = `double-ratchet/invites/${deviceId}`

  const {NDKEvent} = await import("@nostr-dev-kit/ndk")
  const deletionEvent = new NDKEvent(ndk(), {
    kind: 30078, // INVITE_EVENT_KIND
    pubkey: publicKey,
    content: "",
    created_at: Math.floor(Date.now() / 1000),
    tags: [["d", dTag]],
  })

  await deletionEvent.sign()
  await deletionEvent.publish()

  console.log("Published invite tombstone for device:", deviceId)

  // Delete invite from localStorage to prevent republishing
  const {LocalStorageAdapter} = await import("../../session/StorageAdapter")
  const storage = new LocalStorageAdapter("private")
  await storage.del(`invite/${deviceId}`)
}

/**
 * Deletes the current device's invite (convenience wrapper)
 */
export const deleteCurrentDeviceInvite = async () => {
  const manager = getSessionManager()
  if (!manager) {
    console.log("No session manager, skipping invite tombstone")
    return
  }

  await manager.init()
  const deviceId = manager.getDeviceId()
  await deleteDeviceInvite(deviceId)
}
