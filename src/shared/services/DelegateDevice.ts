import {VerifiedEvent} from "nostr-tools"
import {LocalForageStorageAdapter} from "../../session/StorageAdapter"
import {
  NostrPublish,
  NostrSubscribe,
  SecondaryDeviceManager,
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
 * Attach event listener to handle incoming messages on delegate device
 */
const attachDelegateEventListener = (
  deviceManager: SecondaryDeviceManager,
  ownerPublicKey: string
) => {
  unsubscribeEvents?.()
  unsubscribeEvents = deviceManager.onEvent((event, fromPubkey) => {
    log("Delegate device received event from:", fromPubkey)

    const pTag = getTag("p", event.tags)
    if (!pTag) return

    const from = fromPubkey === ownerPublicKey ? pTag : fromPubkey
    const to = fromPubkey === ownerPublicKey ? ownerPublicKey : pTag

    if (!from || !to) return

    void usePrivateMessagesStore.getState().upsert(from, to, event)
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

let manager: SecondaryDeviceManager | null = null

/**
 * Get or create the SecondaryDeviceManager for delegate device operation
 */
export const getSecondaryDeviceManager = (): SecondaryDeviceManager | null => {
  if (manager) return manager

  const credentials = useDelegateDeviceStore.getState().credentials
  if (!credentials) {
    log("No delegate device credentials found")
    return null
  }

  manager = createSecondaryDeviceManager(credentials)
  return manager
}

/**
 * Create a SecondaryDeviceManager from credentials
 */
export const createSecondaryDeviceManager = (
  credentials: DelegateDeviceCredentials
): SecondaryDeviceManager => {
  const ndkInstance = ndk()

  const deviceManager = new SecondaryDeviceManager({
    devicePublicKey: credentials.devicePublicKey,
    devicePrivateKey: getDevicePrivateKeyBytes(credentials),
    ephemeralPublicKey: credentials.ephemeralPublicKey,
    ephemeralPrivateKey: getEphemeralPrivateKeyBytes(credentials),
    sharedSecret: credentials.sharedSecret,
    deviceId: credentials.deviceId,
    deviceLabel: credentials.deviceLabel,
    nostrSubscribe: createSubscribe(ndkInstance),
    nostrPublish: createPublish(ndkInstance),
    storage: new LocalForageStorageAdapter(),
  })

  return deviceManager
}

/**
 * Initialize the delegate device and wait for activation
 * Returns the owner's public key once activated
 */
export const initializeDelegateDevice = async (timeoutMs = 60000): Promise<string> => {
  const deviceManager = getSecondaryDeviceManager()
  if (!deviceManager) {
    throw new Error("No delegate device credentials")
  }

  await deviceManager.init()

  // Check if already activated (owner key stored)
  const ownerKey = deviceManager.getOwnerPublicKey()
  if (ownerKey) {
    log("Delegate device already activated, owner:", ownerKey)
    useDelegateDeviceStore.getState().setOwnerPublicKey(ownerKey)
    useDelegateDeviceStore.getState().setActivated(true)
    attachDelegateEventListener(deviceManager, ownerKey)
    deviceManager.startListening()
    return ownerKey
  }

  // Give NDK time to connect to relays
  log("Waiting for relay connections...")
  await new Promise((resolve) => setTimeout(resolve, 2000))

  // Wait for activation with timeout
  log("Waiting for delegate device activation...")
  const activatedOwnerKey = await deviceManager.waitForActivation(timeoutMs)
  log("Delegate device activated by:", activatedOwnerKey)

  useDelegateDeviceStore.getState().setOwnerPublicKey(activatedOwnerKey)
  useDelegateDeviceStore.getState().setActivated(true)

  // Attach event listener for incoming messages
  attachDelegateEventListener(deviceManager, activatedOwnerKey)

  // Start listening for messages
  deviceManager.startListening()

  return activatedOwnerKey
}

/**
 * Check if the delegate device has been revoked
 */
export const checkDelegateDeviceRevoked = async (): Promise<boolean> => {
  const deviceManager = getSecondaryDeviceManager()
  if (!deviceManager) return false

  return deviceManager.isRevoked()
}

/**
 * Clean up the delegate device manager
 */
export const closeDelegateDevice = () => {
  if (manager) {
    manager.close()
    manager = null
  }
}

/**
 * Clear all delegate device data and reset
 */
export const resetDelegateDevice = () => {
  closeDelegateDevice()
  useDelegateDeviceStore.getState().clear()
}
