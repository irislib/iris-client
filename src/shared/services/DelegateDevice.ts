import {VerifiedEvent} from "nostr-tools"
import {LocalForageStorageAdapter} from "../../session/StorageAdapter"
import {
  NostrPublish,
  NostrSubscribe,
  DeviceManager,
  SessionManager,
  InviteList,
  INVITE_LIST_EVENT_KIND,
  Rumor,
} from "nostr-double-ratchet/src"
import NDK, {NDKEvent, NDKFilter} from "@/lib/ndk"
import {ndk} from "@/utils/ndk"
import {
  useDelegateDeviceStore,
  getDevicePrivateKeyBytes,
  getEphemeralPrivateKeyBytes,
  DelegateDeviceCredentials,
} from "@/stores/delegateDevice"
import {usePrivateMessagesStore} from "@/stores/privateMessages"
import {getTag} from "@/utils/tagUtils"
import {createDebugLogger} from "@/utils/createDebugLogger"
import {DEBUG_NAMESPACES} from "@/utils/constants"

const {log} = createDebugLogger(DEBUG_NAMESPACES.UTILS)

let unsubscribeEvents: (() => void) | null = null

/**
 * Attach event listener to handle incoming messages on delegate device.
 * Uses event.pubkey (actual sender) to determine the conversation party,
 * not the session pubkey which only tells us how the message was delivered.
 */
const attachDelegateEventListener = (
  sessionManager: SessionManager,
  ownerPublicKey: string
) => {
  unsubscribeEvents?.()
  const credentials = useDelegateDeviceStore.getState().credentials
  const delegatePubkey = credentials?.devicePublicKey

  log("[DelegateDevice] attachDelegateEventListener called", {
    deviceId: sessionManager.getDeviceId(),
    ownerPublicKey: ownerPublicKey?.slice(0, 8),
    delegatePubkey: delegatePubkey?.slice(0, 8),
  })

  unsubscribeEvents = sessionManager.onEvent((event: Rumor, sessionPubkey: string) => {
    log("[DelegateDevice] received event:", {
      eventPubkey: event.pubkey?.slice(0, 8),
      sessionPubkey: sessionPubkey?.slice(0, 8),
      ownerPublicKey: ownerPublicKey?.slice(0, 8),
      delegatePubkey: delegatePubkey?.slice(0, 8),
      content: event.content?.slice(0, 20),
    })

    const pTag = getTag("p", event.tags)
    if (!pTag) return

    // Check if message is from us: either owner's pubkey OR this delegate device's pubkey
    const isFromUs =
      event.pubkey === ownerPublicKey ||
      (delegatePubkey && event.pubkey === delegatePubkey)

    // from = the other party in the conversation
    // to = us (always owner's pubkey, regardless of which device received it)
    const from = sessionPubkey
    const to = ownerPublicKey

    if (!from || !to) return

    console.warn("[DelegateDevice] DM identity resolution:", {
      from: from?.slice(0, 8),
      to: to?.slice(0, 8),
      isFromUs,
      pTag: pTag?.slice(0, 8),
    })

    void usePrivateMessagesStore.getState().upsert(from, to, event)
    log("[DelegateDevice] upsert called for chat:", from?.slice(0, 8))
  })
}

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

const createPublish = (ndkInstance: NDK): NostrPublish => {
  return (async (event) => {
    const e = new NDKEvent(ndkInstance, event)
    await e.publish()
    return event
  }) as NostrPublish
}

let deviceManager: DeviceManager | null = null
let sessionManager: SessionManager | null = null

/**
 * Get or create the DeviceManager for delegate device operation
 */
export const getDelegateDeviceManager = (): DeviceManager | null => {
  if (deviceManager) return deviceManager

  const credentials = useDelegateDeviceStore.getState().credentials
  if (!credentials) {
    log("No delegate device credentials found")
    return null
  }

  deviceManager = createDelegateDeviceManager(credentials)
  return deviceManager
}

/**
 * Get or create the SessionManager for delegate device operation
 */
export const getDelegateSessionManager = (): SessionManager | null => {
  if (sessionManager) {
    log("[DelegateDevice] getDelegateSessionManager returning existing", {
      deviceId: sessionManager.getDeviceId(),
    })
    return sessionManager
  }

  const dm = getDelegateDeviceManager()
  if (!dm) return null

  const credentials = useDelegateDeviceStore.getState().credentials
  if (!credentials) return null

  const ndkInstance = ndk()

  log("[DelegateDevice] getDelegateSessionManager creating new SessionManager", {
    deviceId: credentials.deviceId,
    devicePublicKey: credentials.devicePublicKey?.slice(0, 8),
  })

  // IMPORTANT: Must use delegate's own devicePublicKey (not owner's pubkey) for DH encryption
  // to work correctly. The pubkey passed to SessionManager is used for DH key derivation
  // during invite handshakes, so it MUST match the private key being used.
  // UI attribution (showing messages on correct side) is handled separately in the event listener.
  sessionManager = new SessionManager(
    credentials.devicePublicKey,
    getDevicePrivateKeyBytes(credentials),
    credentials.deviceId,
    createSubscribe(ndkInstance),
    createPublish(ndkInstance),
    new LocalForageStorageAdapter(),
    {
      publicKey: credentials.ephemeralPublicKey,
      privateKey: getEphemeralPrivateKeyBytes(credentials),
    },
    credentials.sharedSecret
  )

  return sessionManager
}

/**
 * Create a DeviceManager from credentials
 */
export const createDelegateDeviceManager = (
  credentials: DelegateDeviceCredentials
): DeviceManager => {
  const ndkInstance = ndk()

  return DeviceManager.restoreDelegate({
    deviceId: credentials.deviceId,
    deviceLabel: credentials.deviceLabel,
    devicePublicKey: credentials.devicePublicKey,
    devicePrivateKey: getDevicePrivateKeyBytes(credentials),
    ephemeralPublicKey: credentials.ephemeralPublicKey,
    ephemeralPrivateKey: getEphemeralPrivateKeyBytes(credentials),
    sharedSecret: credentials.sharedSecret,
    nostrSubscribe: createSubscribe(ndkInstance),
    nostrPublish: createPublish(ndkInstance),
    storage: new LocalForageStorageAdapter(),
  })
}

/**
 * Initialize the delegate device and wait for activation
 * Returns the owner's public key once activated
 */
export const initializeDelegateDevice = async (timeoutMs = 60000): Promise<string> => {
  const dm = getDelegateDeviceManager()
  if (!dm) {
    throw new Error("No delegate device credentials")
  }

  await dm.init()

  // Check if already activated (owner key stored)
  const ownerKey = dm.getOwnerPublicKey()
  if (ownerKey) {
    log("Delegate device already activated, owner:", ownerKey)
    useDelegateDeviceStore.getState().setOwnerPublicKey(ownerKey)
    useDelegateDeviceStore.getState().setActivated(true)

    // Initialize and attach session manager
    const sm = getDelegateSessionManager()
    if (sm) {
      await sm.init()
      attachDelegateEventListener(sm, ownerKey)
    }
    return ownerKey
  }

  // Give NDK time to connect to relays
  log("Waiting for relay connections...")
  await new Promise((resolve) => setTimeout(resolve, 2000))

  // Wait for activation with timeout
  log("Waiting for delegate device activation...")
  const activatedOwnerKey = await dm.waitForActivation(timeoutMs)
  log("Delegate device activated by:", activatedOwnerKey)

  useDelegateDeviceStore.getState().setOwnerPublicKey(activatedOwnerKey)
  useDelegateDeviceStore.getState().setActivated(true)

  // Initialize and attach session manager for incoming messages
  const sm = getDelegateSessionManager()
  if (sm) {
    await sm.init()
    attachDelegateEventListener(sm, activatedOwnerKey)
  }

  return activatedOwnerKey
}

/**
 * Resume a previously activated delegate device.
 * This is a lighter initialization than initializeDelegateDevice() -
 * it only initializes the SessionManager and attaches event listeners,
 * without re-initializing the DeviceManager or waiting for activation.
 */
export const resumeDelegateDevice = async (ownerPublicKey: string): Promise<void> => {
  const sm = getDelegateSessionManager()
  if (!sm) {
    throw new Error("No delegate session manager")
  }

  await sm.init()
  attachDelegateEventListener(sm, ownerPublicKey)
  log("Delegate device resumed for owner:", ownerPublicKey)
}

/**
 * Check if the delegate device has been revoked
 */
export const checkDelegateDeviceRevoked = async (): Promise<boolean> => {
  const dm = getDelegateDeviceManager()
  if (!dm) return false

  return dm.isRevoked()
}

/**
 * Clean up the delegate device manager
 */
export const closeDelegateDevice = () => {
  if (deviceManager) {
    deviceManager.close()
    deviceManager = null
  }
  if (sessionManager) {
    sessionManager.close()
    sessionManager = null
  }
}

/**
 * Clear all delegate device data and reset
 */
export const resetDelegateDevice = () => {
  closeDelegateDevice()
  useDelegateDeviceStore.getState().clear()
}

/**
 * Send a message from the delegate device.
 * If no session exists, will attempt to initiate one first.
 * Also syncs the message to the owner's other devices.
 */
export const sendDelegateMessage = async (
  recipientPublicKey: string,
  content: string
) => {
  const sm = getDelegateSessionManager()
  if (!sm) {
    throw new Error("Delegate device not initialized")
  }

  const credentials = useDelegateDeviceStore.getState().credentials
  const ownerPublicKey = credentials?.ownerPublicKey
  if (!ownerPublicKey) {
    throw new Error("Delegate device not activated (no owner public key)")
  }

  // First try to send with existing session
  let rumor = await sm.sendMessage(recipientPublicKey, content)

  if (!rumor) {
    // No session - try to initiate one
    log("No session with recipient, attempting to initiate...")
    const initiated = await initiateSessionFromDelegate(recipientPublicKey)

    if (!initiated) {
      throw new Error("Could not establish session with recipient")
    }

    // Wait a moment for session to be ready
    await new Promise((resolve) => setTimeout(resolve, 1000))

    // Try sending again
    rumor = await sm.sendMessage(recipientPublicKey, content)

    if (!rumor) {
      throw new Error("Session initiated but message still failed to send")
    }
  }

  log("Delegate device sent message to:", recipientPublicKey)

  // Sync to owner's other devices (if recipient isn't the owner)
  // This ensures the owner's main device sees messages sent from the delegate
  // Use normalized pubkey (owner's) so all devices recognize it as "ours"
  if (recipientPublicKey !== ownerPublicKey) {
    log("Syncing message to owner's devices...")
    const normalizedRumor = {...rumor, pubkey: ownerPublicKey}
    sm.sendEvent(ownerPublicKey, normalizedRumor).catch((err) => {
      log("Failed to sync to owner devices:", err)
    })
  }

  return rumor
}

/**
 * Check if we're running as a delegate device
 */
export const isDelegateDevice = (): boolean => {
  const credentials = useDelegateDeviceStore.getState().credentials
  return credentials !== null
}

/**
 * Initiate a session with a recipient from the delegate device.
 * This fetches the recipient's InviteList and establishes sessions with their devices.
 */
export const initiateSessionFromDelegate = async (
  recipientPublicKey: string
): Promise<boolean> => {
  const credentials = useDelegateDeviceStore.getState().credentials
  if (!credentials) {
    throw new Error("No delegate device credentials")
  }

  const ndkInstance = ndk()
  const nostrSubscribe = createSubscribe(ndkInstance)
  const nostrPublish = createPublish(ndkInstance)

  log("Initiating session with:", recipientPublicKey)

  // Fetch recipient's InviteList
  const inviteList = await new Promise<InviteList | null>((resolve) => {
    let resolved = false
    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true
        unsubscribe()
        resolve(null)
      }
    }, 10000)

    const unsubscribe = nostrSubscribe(
      {
        kinds: [INVITE_LIST_EVENT_KIND],
        authors: [recipientPublicKey],
        "#d": ["double-ratchet/invite-list"],
        limit: 1,
      },
      (event: VerifiedEvent) => {
        if (resolved) return
        try {
          const list = InviteList.fromEvent(event)
          resolved = true
          clearTimeout(timeout)
          unsubscribe()
          resolve(list)
        } catch {
          // Invalid event, ignore
        }
      }
    )
  })

  if (!inviteList) {
    log("No InviteList found for recipient:", recipientPublicKey)
    return false
  }

  const devices = inviteList.getAllDevices()
  if (devices.length === 0) {
    log("Recipient has no devices in InviteList")
    return false
  }

  log("Found", devices.length, "devices for recipient")

  // Accept invite from each device to establish sessions
  let sessionsCreated = 0
  for (const device of devices) {
    try {
      const {event} = await inviteList.accept(
        device.deviceId,
        nostrSubscribe,
        credentials.devicePublicKey, // Our public key
        getDevicePrivateKeyBytes(credentials), // Our private key for encryption
        credentials.deviceId // Our device ID
      )

      // Publish the invite response
      await nostrPublish(event)
      log("Published invite response to device:", device.deviceId)

      // The session is now active - SessionManager should pick it up via invite response listener
      sessionsCreated++
    } catch (err) {
      log("Failed to accept invite from device:", device.deviceId, err)
    }
  }

  log("Created", sessionsCreated, "sessions with recipient")
  return sessionsCreated > 0
}
