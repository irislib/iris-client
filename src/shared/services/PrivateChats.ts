import {VerifiedEvent} from "nostr-tools"
import {LocalForageStorageAdapter} from "../../session/StorageAdapter"
import {
  NostrPublish,
  NostrSubscribe,
  SessionManager,
  DeviceManager,
} from "nostr-double-ratchet/src"
import NDK, {NDKEvent, NDKFilter} from "@/lib/ndk"
import {ndk} from "@/utils/ndk"
import {useUserStore} from "../../stores/user"
import {hexToBytes} from "nostr-tools/utils"
import {createDebugLogger} from "@/utils/createDebugLogger"
import {DEBUG_NAMESPACES} from "@/utils/constants"

const {log} = createDebugLogger(DEBUG_NAMESPACES.UTILS)

const createSubscribe = (ndk: NDK): NostrSubscribe => {
  return (filter: NDKFilter, onEvent: (event: VerifiedEvent) => void) => {
    const subscription = ndk.subscribe(filter)

    subscription.on("event", (event: NDKEvent) => {
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
    await e.publish()
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

let deviceManagerInstance: DeviceManager | null = null
let sessionManagerInstance: SessionManager | null = null

export const getDeviceManager = (): DeviceManager => {
  if (deviceManagerInstance) return deviceManagerInstance

  const {publicKey, privateKey} = useUserStore.getState()

  if (!privateKey) {
    throw new Error(
      "DeviceManager requires a private key - extension-only mode not supported"
    )
  }

  const ndkInstance = ndk()

  deviceManagerInstance = DeviceManager.createMain({
    ownerPublicKey: publicKey,
    ownerPrivateKey: hexToBytes(privateKey),
    deviceId: getOrCreateDeviceId(),
    deviceLabel: getOrCreateDeviceId(),
    nostrSubscribe: createSubscribe(ndkInstance),
    nostrPublish: createPublish(ndkInstance),
    storage: new LocalForageStorageAdapter(),
  })

  return deviceManagerInstance
}

export const getSessionManager = (): SessionManager => {
  if (sessionManagerInstance) return sessionManagerInstance

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

  sessionManagerInstance = new SessionManager(
    publicKey,
    encrypt,
    getOrCreateDeviceId(),
    createSubscribe(ndkInstance),
    createPublish(ndkInstance),
    new LocalForageStorageAdapter()
  )

  // Initialize DeviceManager in background to publish InviteList
  if (privateKey) {
    const deviceManager = getDeviceManager()
    deviceManager.init().then(() => {
      // After init, ephemeral keys are available - update SessionManager
      const ephemeralKeypair = deviceManager.getEphemeralKeypair()
      const sharedSecret = deviceManager.getSharedSecret()
      if (ephemeralKeypair && sharedSecret) {
        sessionManagerInstance?.setEphemeralKeys(ephemeralKeypair, sharedSecret)
      }
    }).catch(console.error)
  }

  return sessionManagerInstance
}

export const revokeCurrentDevice = async (): Promise<void> => {
  const {publicKey, privateKey} = useUserStore.getState()
  if (!publicKey || !privateKey) return

  const deviceManager = getDeviceManager()
  await deviceManager.init()
  const deviceId = deviceManager.getDeviceId()
  await deviceManager.revokeDevice(deviceId)
}

/**
 * Publishes a tombstone event to nullify a device's chat invite
 * Makes the invite invisible to other devices
 */
export const deleteDeviceInvite = async (deviceId: string) => {
  const {publicKey} = useUserStore.getState()

  // Publish tombstone event - same kind and d tag, empty content
  const dTag = `double-ratchet/invites/${deviceId}`

  const {NDKEvent} = await import("@/lib/ndk")
  const deletionEvent = new NDKEvent(ndk(), {
    kind: 30078, // INVITE_EVENT_KIND
    pubkey: publicKey,
    content: "",
    created_at: Math.floor(Date.now() / 1000),
    tags: [["d", dTag]],
  })

  await deletionEvent.sign()
  await deletionEvent.publish()

  log("Published invite tombstone for device:", deviceId)

  // Delete invite from our local persistence to prevent republishing
  const {LocalForageStorageAdapter} = await import("../../session/StorageAdapter")
  const storage = new LocalForageStorageAdapter()
  await storage.del(`invite/${deviceId}`)
}

/**
 * Deletes the current device's invite (convenience wrapper)
 */
export const deleteCurrentDeviceInvite = async () => {
  const manager = getSessionManager()
  if (!manager) {
    log("No session manager, skipping invite tombstone")
    return
  }

  await manager.init()
  const deviceId = manager.getDeviceId()
  await deleteDeviceInvite(deviceId)
}
