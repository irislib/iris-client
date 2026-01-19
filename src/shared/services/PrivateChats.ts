import {VerifiedEvent} from "nostr-tools"
import {LocalForageStorageAdapter} from "../../session/StorageAdapter"
import {
  NostrPublish,
  NostrSubscribe,
  SessionManager,
  DeviceManager,
  DecryptFunction,
  EncryptFunction,
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
let initPromise: Promise<void> | null = null

/**
 * Create NIP-44 decrypt function using browser extension (NIP-07)
 */
const createExtensionDecrypt = (): DecryptFunction => {
  return async (ciphertext: string, pubkey: string): Promise<string> => {
    if (!window.nostr?.nip44?.decrypt) {
      throw new Error("NIP-44 decrypt not available in extension")
    }
    return await window.nostr.nip44.decrypt(pubkey, ciphertext)
  }
}

/**
 * Create NIP-44 encrypt function using browser extension (NIP-07)
 */
const createExtensionEncrypt = (): EncryptFunction => {
  return async (plaintext: string, pubkey: string): Promise<string> => {
    if (!window.nostr?.nip44?.encrypt) {
      throw new Error("NIP-44 encrypt not available in extension")
    }
    return await window.nostr.nip44.encrypt(pubkey, plaintext)
  }
}

export const getDeviceManager = (): DeviceManager => {
  if (deviceManagerInstance) return deviceManagerInstance

  const {publicKey, privateKey, nip07Login} = useUserStore.getState()

  const ndkInstance = ndk()

  if (privateKey) {
    // Standard login with private key
    deviceManagerInstance = DeviceManager.createOwnerDevice({
      ownerPublicKey: publicKey,
      ownerPrivateKey: hexToBytes(privateKey),
      deviceId: getOrCreateDeviceId(),
      deviceLabel: getOrCreateDeviceId(),
      nostrSubscribe: createSubscribe(ndkInstance),
      nostrPublish: createPublish(ndkInstance),
      storage: new LocalForageStorageAdapter(),
    })
  } else if (nip07Login && window.nostr) {
    // Extension login (NIP-07) - use decrypt/encrypt functions
    deviceManagerInstance = DeviceManager.createOwnerDevice({
      ownerPublicKey: publicKey,
      ownerPrivateKey: createExtensionDecrypt(),
      ownerEncrypt: createExtensionEncrypt(),
      deviceId: getOrCreateDeviceId(),
      deviceLabel: getOrCreateDeviceId(),
      nostrSubscribe: createSubscribe(ndkInstance),
      nostrPublish: createPublish(ndkInstance),
      storage: new LocalForageStorageAdapter(),
    })
  } else {
    throw new Error("DeviceManager requires either a private key or NIP-07 extension")
  }

  return deviceManagerInstance
}

/**
 * Initialize DeviceManager and create SessionManager from it.
 * This ensures ephemeral keys are available before SessionManager is created.
 */
const initializeManagers = async (): Promise<void> => {
  if (sessionManagerInstance) return

  const deviceManager = getDeviceManager()
  await deviceManager.init()

  // Use DeviceManager to create properly configured SessionManager
  sessionManagerInstance = deviceManager.createSessionManager()
  await sessionManagerInstance.init()
}

/**
 * Get or create the SessionManager instance.
 * If called before initialization completes, waits for init.
 */
export const getSessionManagerAsync = async (): Promise<SessionManager> => {
  // Start initialization if not already started
  if (!initPromise) {
    initPromise = initializeManagers().catch((e) => {
      console.error("Failed to initialize managers:", e)
      initPromise = null // Allow retry on error
      throw e
    })
  }

  await initPromise

  if (!sessionManagerInstance) {
    throw new Error("SessionManager not initialized")
  }

  return sessionManagerInstance
}

/**
 * Synchronous getter - returns the manager if initialized, otherwise throws.
 * Prefer getSessionManagerAsync() for most use cases.
 */
export const getSessionManager = (): SessionManager => {
  // Start initialization in background if not started
  if (!initPromise) {
    initPromise = initializeManagers().catch((e) => {
      console.error("Failed to initialize managers:", e)
      initPromise = null
    })
  }

  if (!sessionManagerInstance) {
    throw new Error(
      "SessionManager not yet initialized. Use getSessionManagerAsync() or ensure init has completed."
    )
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
  try {
    const manager = await getSessionManagerAsync()
    const deviceId = manager.getDeviceId()
    await deleteDeviceInvite(deviceId)
  } catch {
    log("No session manager, skipping invite tombstone")
  }
}
