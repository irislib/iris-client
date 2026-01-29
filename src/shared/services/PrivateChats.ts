import {VerifiedEvent} from "nostr-tools"
import {LocalForageStorageAdapter} from "../../session/StorageAdapter"
import {
  NostrPublish,
  NostrSubscribe,
  SessionManager,
  DelegateManager,
  AppKeysManager,
  AppKeys,
  DeviceEntry,
} from "nostr-double-ratchet/src"
import NDK, {NDKEvent, NDKFilter} from "@/lib/ndk"
import {ndk} from "@/utils/ndk"
import {useUserStore} from "../../stores/user"
import {useDevicesStore} from "../../stores/devices"
import {createDebugLogger} from "@/utils/createDebugLogger"
import {DEBUG_NAMESPACES} from "@/utils/constants"

const {log} = createDebugLogger(DEBUG_NAMESPACES.UTILS)

// Global AppKeys subscription cleanup function
let appKeysSubscriptionCleanup: (() => void) | null = null

const createSubscribe = (ndkInstance: NDK): NostrSubscribe => {
  return (filter: NDKFilter, onEvent: (event: VerifiedEvent) => void) => {
    const subscription = ndkInstance.subscribe(filter)

    subscription.on("event", (event: NDKEvent) => {
      onEvent(event as unknown as VerifiedEvent)
    })

    subscription.start()

    return () => {
      subscription.stop()
    }
  }
}

/**
 * Get NostrSubscribe function for the current NDK instance.
 */
export const getNostrSubscribe = (): NostrSubscribe => {
  return createSubscribe(ndk())
}

// NDK-compatible publish function - TODO: remove "as" by handling nostr-tools version mismatch between lib and app
const createPublish = (ndkInstance: NDK): NostrPublish => {
  return (async (event) => {
    const e = new NDKEvent(ndkInstance, event)
    await e.publish()
    return event
  }) as NostrPublish
}

// Singletons
let delegateManager: DelegateManager | null = null
let appKeysManager: AppKeysManager | null = null
let sessionManager: SessionManager | null = null

// Track initialization promises
let appKeysInitPromise: Promise<void> | null = null
let delegateInitPromise: Promise<void> | null = null
let sessionManagerInitPromise: Promise<void> | null = null

/**
 * Get the DelegateManager singleton.
 * Must call initDelegateManager first.
 */
export const getDelegateManager = (): DelegateManager => {
  if (!delegateManager) {
    throw new Error("DelegateManager not initialized - call initDelegateManager first")
  }
  return delegateManager
}

/**
 * Get the AppKeysManager singleton.
 * Must call initAppKeysManager first.
 */
export const getAppKeysManager = (): AppKeysManager => {
  if (!appKeysManager) {
    throw new Error("AppKeysManager not initialized - call initAppKeysManager first")
  }
  return appKeysManager
}

/**
 * Initialize AppKeysManager singleton.
 * Fast initialization - can be used before DelegateManager is ready.
 */
export const initAppKeysManager = async (): Promise<void> => {
  if (appKeysManager) return
  if (appKeysInitPromise) return appKeysInitPromise

  appKeysInitPromise = (async () => {
    const ndkInstance = ndk()
    const storage = new LocalForageStorageAdapter()

    appKeysManager = new AppKeysManager({
      nostrPublish: createPublish(ndkInstance),
      storage,
    })

    await appKeysManager.init()
    log("AppKeysManager initialized")
  })()

  await appKeysInitPromise
}

/**
 * Initialize DelegateManager singleton.
 * Should be called early in app initialization.
 */
export const initDelegateManager = async (): Promise<void> => {
  if (delegateManager) return
  if (delegateInitPromise) return delegateInitPromise

  delegateInitPromise = (async () => {
    const ndkInstance = ndk()
    const storage = new LocalForageStorageAdapter()

    delegateManager = new DelegateManager({
      nostrSubscribe: createSubscribe(ndkInstance),
      nostrPublish: createPublish(ndkInstance),
      storage,
    })

    await delegateManager.init()
    log("DelegateManager initialized")
  })()

  await delegateInitPromise
}

/**
 * Activate this device with the given owner pubkey.
 * Creates the SessionManager after activation.
 */
export const activateDevice = async (ownerPubkey: string): Promise<void> => {
  if (sessionManagerInitPromise) return sessionManagerInitPromise

  sessionManagerInitPromise = (async () => {
    if (!delegateManager) {
      throw new Error("DelegateManager not initialized")
    }

    await delegateManager.activate(ownerPubkey)
    sessionManager = delegateManager.createSessionManager(new LocalForageStorageAdapter())

    log("Device activated for owner:", ownerPubkey)
  })()

  await sessionManagerInitPromise
}

/**
 * Get the SessionManager singleton.
 * Returns null if device is not yet activated.
 */
export const getSessionManager = (): SessionManager | null => {
  return sessionManager
}

/**
 * Wait for AppKeysManager to be initialized.
 */
export const waitForAppKeysManager = async (): Promise<AppKeysManager> => {
  if (appKeysInitPromise) await appKeysInitPromise
  if (!appKeysManager) {
    throw new Error("AppKeysManager not initialized")
  }
  return appKeysManager
}

/**
 * Wait for DelegateManager to be initialized.
 */
export const waitForDelegateManager = async (): Promise<DelegateManager> => {
  if (delegateInitPromise) await delegateInitPromise
  if (!delegateManager) {
    throw new Error("DelegateManager not initialized")
  }
  return delegateManager
}

/**
 * Wait for DelegateManager and AppKeysManager to be initialized.
 */
export const waitForManagers = async (): Promise<void> => {
  await Promise.all([waitForAppKeysManager(), waitForDelegateManager()])
}

/**
 * Wait for SessionManager to be initialized.
 */
export const waitForSessionManager = async (): Promise<SessionManager> => {
  if (sessionManagerInitPromise) await sessionManagerInitPromise
  if (!sessionManager) {
    throw new Error("SessionManager not initialized - device not activated")
  }
  return sessionManager
}

/**
 * Check if AppKeys exist locally with registered devices.
 * Returns true if: AppKeys can be read from storage AND contains at least one device.
 */
export const hasLocalAppKeys = (): boolean => {
  if (!appKeysManager) return false
  const appKeys = appKeysManager.getAppKeys()
  return appKeys !== null && appKeys.getAllDevices().length > 0
}

/**
 * Register the current device by adding it to AppKeys.
 * Fetches existing devices from relay first to avoid overwriting them.
 */
export const registerDevice = async (): Promise<void> => {
  const {publicKey} = useUserStore.getState()
  if (!publicKey) {
    throw new Error("No public key - user must be logged in")
  }

  if (!delegateManager || !appKeysManager) {
    throw new Error("Managers not initialized")
  }

  // Fetch existing AppKeys from relay first
  const nostrSubscribe = getNostrSubscribe()
  const existingKeys = await AppKeys.waitFor(publicKey, nostrSubscribe, 2000)

  if (existingKeys) {
    // Merge with existing devices
    await appKeysManager.setAppKeys(existingKeys)
    log("Loaded existing AppKeys with", existingKeys.getAllDevices().length, "devices")
  }

  // Add this device
  const payload = delegateManager.getRegistrationPayload()
  appKeysManager.addDevice(payload)
  await appKeysManager.publish()

  log("Device registered:", payload.identityPubkey)
}

/**
 * Revoke a device by removing it from AppKeys.
 * Fetches existing devices from relay first to avoid data loss.
 */
export const revokeDevice = async (identityPubkey: string): Promise<void> => {
  const {publicKey} = useUserStore.getState()
  if (!publicKey) {
    throw new Error("No public key - user must be logged in")
  }

  if (!appKeysManager) {
    throw new Error("AppKeysManager not initialized")
  }

  // Fetch existing AppKeys from relay first
  const nostrSubscribe = getNostrSubscribe()
  const existingKeys = await AppKeys.waitFor(publicKey, nostrSubscribe, 2000)

  if (existingKeys) {
    await appKeysManager.setAppKeys(existingKeys)
    log("Loaded existing AppKeys with", existingKeys.getAllDevices().length, "devices")
  }

  appKeysManager.revokeDevice(identityPubkey)
  await appKeysManager.publish()

  log("Device revoked:", identityPubkey)
}

export interface PreparedRegistration {
  appKeys: AppKeys
  devices: DeviceEntry[]
  newDeviceIdentity: string
}

/**
 * Prepare device registration without mutating any state.
 * Uses devices from the store (populated by AppKeys subscription).
 * Call publishPreparedRegistration() to actually publish.
 */
export const prepareRegistration = async (): Promise<PreparedRegistration> => {
  const {publicKey} = useUserStore.getState()
  if (!publicKey) {
    throw new Error("No public key - user must be logged in")
  }

  if (!delegateManager) {
    throw new Error("DelegateManager not initialized")
  }

  // Use devices from the store (populated by AppKeys subscription)
  const {registeredDevices} = useDevicesStore.getState()

  // Create AppKeys from store devices
  const appKeys = new AppKeys(registeredDevices)

  // Add current device
  const payload = delegateManager.getRegistrationPayload()
  const device: DeviceEntry = {
    identityPubkey: payload.identityPubkey,
    createdAt: Math.floor(Date.now() / 1000),
  }
  appKeys.addDevice(device)

  return {
    appKeys,
    devices: appKeys.getAllDevices(),
    newDeviceIdentity: payload.identityPubkey,
  }
}

/**
 * Publish a prepared registration and update state.
 * Only updates AppKeysManager and store AFTER successful publish.
 */
export const publishPreparedRegistration = async (
  prepared: PreparedRegistration
): Promise<void> => {
  const ndkInstance = ndk()

  // Get the unsigned event and publish via NDK (which will sign it)
  const unsignedEvent = prepared.appKeys.getEvent()
  const ndkEvent = new NDKEvent(ndkInstance, unsignedEvent)
  await ndkEvent.publish()

  // Update with the timestamp from the event we just published
  const eventTimestamp = ndkEvent.created_at ?? Math.floor(Date.now() / 1000)

  // Only after successful publish: update AppKeysManager and store
  if (appKeysManager) {
    await appKeysManager.setAppKeys(prepared.appKeys)
  }

  // Store update with timestamp - this becomes the source of truth
  useDevicesStore.getState().setRegisteredDevices(prepared.devices, eventTimestamp)

  log("Device registered:", prepared.newDeviceIdentity)
}

export interface PreparedRevocation {
  appKeys: AppKeys
  devices: DeviceEntry[]
  revokedIdentity: string
}

/**
 * Prepare device revocation without mutating any state.
 */
export const prepareRevocation = async (
  identityPubkey: string
): Promise<PreparedRevocation> => {
  const {publicKey} = useUserStore.getState()
  if (!publicKey) {
    throw new Error("No public key - user must be logged in")
  }

  // Use devices from the store (populated by AppKeys subscription)
  const {registeredDevices} = useDevicesStore.getState()

  if (registeredDevices.length === 0) {
    throw new Error("No devices found - cannot prepare revocation")
  }

  // Create AppKeys from store devices
  const appKeys = new AppKeys(registeredDevices)

  // Remove the device
  appKeys.removeDevice(identityPubkey)

  return {
    appKeys,
    devices: appKeys.getAllDevices(),
    revokedIdentity: identityPubkey,
  }
}

/**
 * Publish a prepared revocation and update state.
 */
export const publishPreparedRevocation = async (
  prepared: PreparedRevocation
): Promise<void> => {
  const ndkInstance = ndk()

  const unsignedEvent = prepared.appKeys.getEvent()
  const ndkEvent = new NDKEvent(ndkInstance, unsignedEvent)
  await ndkEvent.publish()

  // Update with the timestamp from the event we just published
  const eventTimestamp = ndkEvent.created_at ?? Math.floor(Date.now() / 1000)

  // Only after successful publish: update AppKeysManager and store
  if (appKeysManager) {
    await appKeysManager.setAppKeys(prepared.appKeys)
  }

  // Store update with timestamp - this becomes the source of truth
  useDevicesStore.getState().setRegisteredDevices(prepared.devices, eventTimestamp)

  log("Device revoked:", prepared.revokedIdentity)
}

export const revokeCurrentDevice = async (): Promise<void> => {
  if (!delegateManager) {
    log("DelegateManager not initialized, skipping device revocation")
    return
  }

  const identityPubkey = delegateManager.getIdentityPublicKey()
  await revokeDevice(identityPubkey)
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

/**
 * Start a global subscription to AppKeys events.
 * Runs for app lifetime, merges events with AppKeysManager, and updates store.
 */
export const startAppKeysSubscription = (ownerPubkey: string): void => {
  if (appKeysSubscriptionCleanup) return // Already running

  const ndkInstance = ndk()
  const subscription = ndkInstance.subscribe({
    kinds: [30078],
    authors: [ownerPubkey],
    "#d": ["double-ratchet/app-keys"],
  } as NDKFilter)

  subscription.on("event", async (event: NDKEvent) => {
    try {
      const eventTime = event.created_at ?? 0
      const storeTimestamp = useDevicesStore.getState().lastEventTimestamp

      // Skip if we already have this or a newer event
      if (eventTime <= storeTimestamp) {
        return
      }

      const incomingAppKeys = AppKeys.fromEvent(event as unknown as VerifiedEvent)

      if (appKeysManager) {
        await appKeysManager.setAppKeys(incomingAppKeys)
        const devices = appKeysManager.getOwnDevices()
        // Update store with timestamp
        useDevicesStore.getState().setRegisteredDevices(devices, eventTime)
        log("AppKeys updated from subscription:", devices.length, "devices")
      }
    } catch (err) {
      log("Failed to process AppKeys event:", err)
    }
  })

  subscription.start()
  appKeysSubscriptionCleanup = () => subscription.stop()
  log("AppKeys subscription started")
}

/**
 * Stop the global AppKeys subscription.
 */
export const stopAppKeysSubscription = (): void => {
  if (appKeysSubscriptionCleanup) {
    appKeysSubscriptionCleanup()
    appKeysSubscriptionCleanup = null
    log("AppKeys subscription stopped")
  }
}

/**
 * Republish the current device's invite event.
 * Useful if the invite wasn't published or relays lost it.
 */
export const republishInvite = async (): Promise<void> => {
  if (!delegateManager) {
    throw new Error("DelegateManager not initialized")
  }

  const invite = delegateManager.getInvite()
  if (!invite) {
    throw new Error("No invite available")
  }

  // Sign with device identity key, not user's main key
  const {finalizeEvent} = await import("nostr-tools")
  const unsignedEvent = invite.getEvent()
  const signedEvent = finalizeEvent(unsignedEvent, delegateManager.getIdentityKey())

  const ndkInstance = ndk()
  const {NDKEvent} = await import("@/lib/ndk")

  // Wait for relays to connect if needed
  if (ndkInstance.pool.connectedRelays().length === 0) {
    await ndkInstance.pool.connect(5000)
  }

  const event = new NDKEvent(ndkInstance, signedEvent)
  const relays = await event.publish()
  log(
    "Republished invite to relays:",
    Array.from(relays).map((r) => r.url)
  )
}

/**
 * Rotate the current device's invite - generates new keys and publishes.
 */
export const rotateInvite = async (): Promise<void> => {
  if (!delegateManager) {
    throw new Error("DelegateManager not initialized")
  }

  await delegateManager.rotateInvite()
  log("Rotated invite for device:", delegateManager.getIdentityPublicKey())
}

/**
 * Get the current device's invite details.
 */
export const getInviteDetails = (): {
  ephemeralPublicKey: string
  sharedSecret: string
  deviceId: string
} | null => {
  if (!delegateManager) return null

  const invite = delegateManager.getInvite()
  if (!invite) return null

  return {
    ephemeralPublicKey: invite.inviterEphemeralPublicKey,
    sharedSecret: invite.sharedSecret,
    deviceId: invite.deviceId || delegateManager.getIdentityPublicKey(),
  }
}

/**
 * Check if the current device's invite exists on relays.
 * Returns the event if found, null otherwise.
 */
export const checkInviteOnRelay = async (): Promise<{
  found: boolean
  eventId?: string
  createdAt?: number
}> => {
  if (!delegateManager) {
    return {found: false}
  }

  const deviceId = delegateManager.getIdentityPublicKey()
  const ndkInstance = ndk()

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      subscription.stop()
      resolve({found: false})
    }, 3000)

    const subscription = ndkInstance.subscribe({
      kinds: [30078],
      authors: [deviceId],
      "#d": [`double-ratchet/invites/${deviceId}`],
    } as NDKFilter)

    subscription.on("event", (event: NDKEvent) => {
      clearTimeout(timeout)
      subscription.stop()

      // Check if it's a valid invite (has ephemeralKey tag) or a tombstone
      const hasEphemeralKey = event.tags.some(([k]) => k === "ephemeralKey")

      if (hasEphemeralKey) {
        resolve({
          found: true,
          eventId: event.id,
          createdAt: event.created_at,
        })
      } else {
        resolve({found: false}) // Tombstone
      }
    })

    subscription.start()
  })
}
