import {create} from "zustand"
import type {DeviceEntry} from "nostr-double-ratchet"

interface DeviceState {
  identityPubkey: string | null
  registeredDevices: DeviceEntry[]
  isCurrentDeviceRegistered: boolean
  appKeysManagerReady: boolean
  sessionManagerReady: boolean
  hasLocalAppKeys: boolean
  lastEventTimestamp: number // Track last processed AppKeys event timestamp
  pendingAutoRegistration: boolean
  // Computed
  canSendPrivateMessages: boolean
  // Actions
  setIdentityPubkey: (pubkey: string) => void
  setRegisteredDevices: (devices: DeviceEntry[], timestamp?: number) => void
  setAppKeysManagerReady: (ready: boolean) => void
  setSessionManagerReady: (ready: boolean) => void
  setHasLocalAppKeys: (has: boolean) => void
  setPendingAutoRegistration: (pending: boolean) => void
}

const initialState = {
  identityPubkey: null,
  registeredDevices: [],
  isCurrentDeviceRegistered: false,
  appKeysManagerReady: false,
  sessionManagerReady: false,
  hasLocalAppKeys: false,
  lastEventTimestamp: 0,
  pendingAutoRegistration: false,
  canSendPrivateMessages: false,
}

const computeCanSendPrivateMessages = (
  appKeysManagerReady: boolean,
  sessionManagerReady: boolean,
  hasLocalAppKeys: boolean,
  isCurrentDeviceRegistered: boolean,
  registeredDevicesCount: number
): boolean => {
  // Can send if managers are ready and we have any known device keys for this account.
  // A sign-in on a fresh browser may not have local keys yet, but can still use
  // an already-registered sibling device discovered from AppKeys events.
  return (
    appKeysManagerReady &&
    sessionManagerReady &&
    (hasLocalAppKeys || isCurrentDeviceRegistered || registeredDevicesCount > 0)
  )
}

export const useDevicesStore = create<DeviceState>()((set, get) => ({
  ...initialState,
  setIdentityPubkey: (pubkey: string) => {
    const {registeredDevices, appKeysManagerReady, sessionManagerReady, hasLocalAppKeys} =
      get()
    const isCurrentDeviceRegistered = registeredDevices.some(
      (d) => d.identityPubkey === pubkey
    )
    set({
      identityPubkey: pubkey,
      isCurrentDeviceRegistered,
      canSendPrivateMessages: computeCanSendPrivateMessages(
        appKeysManagerReady,
        sessionManagerReady,
        hasLocalAppKeys,
        isCurrentDeviceRegistered,
        registeredDevices.length
      ),
    })
  },
  setRegisteredDevices: (devices: DeviceEntry[], timestamp?: number) => {
    const {
      identityPubkey,
      appKeysManagerReady,
      sessionManagerReady,
      hasLocalAppKeys,
      lastEventTimestamp,
    } = get()
    // Only update if timestamp is newer (or no timestamp = forced update)
    if (timestamp !== undefined && timestamp <= lastEventTimestamp) {
      return // Skip older events
    }
    const isCurrentDeviceRegistered = identityPubkey
      ? devices.some((d) => d.identityPubkey === identityPubkey)
      : false
    set({
      registeredDevices: devices,
      isCurrentDeviceRegistered,
      lastEventTimestamp: timestamp ?? lastEventTimestamp,
      canSendPrivateMessages: computeCanSendPrivateMessages(
        appKeysManagerReady,
        sessionManagerReady,
        hasLocalAppKeys,
        isCurrentDeviceRegistered,
        devices.length
      ),
    })
  },
  setAppKeysManagerReady: (ready: boolean) => {
    const {
      sessionManagerReady,
      hasLocalAppKeys,
      isCurrentDeviceRegistered,
      registeredDevices,
    } = get()
    set({
      appKeysManagerReady: ready,
      canSendPrivateMessages: computeCanSendPrivateMessages(
        ready,
        sessionManagerReady,
        hasLocalAppKeys,
        isCurrentDeviceRegistered,
        registeredDevices.length
      ),
    })
  },
  setSessionManagerReady: (ready: boolean) => {
    const {
      appKeysManagerReady,
      hasLocalAppKeys,
      isCurrentDeviceRegistered,
      registeredDevices,
    } = get()
    set({
      sessionManagerReady: ready,
      canSendPrivateMessages: computeCanSendPrivateMessages(
        appKeysManagerReady,
        ready,
        hasLocalAppKeys,
        isCurrentDeviceRegistered,
        registeredDevices.length
      ),
    })
  },
  setHasLocalAppKeys: (has: boolean) => {
    const {
      appKeysManagerReady,
      sessionManagerReady,
      isCurrentDeviceRegistered,
      registeredDevices,
    } = get()
    set({
      hasLocalAppKeys: has,
      canSendPrivateMessages: computeCanSendPrivateMessages(
        appKeysManagerReady,
        sessionManagerReady,
        has,
        isCurrentDeviceRegistered,
        registeredDevices.length
      ),
    })
  },
  setPendingAutoRegistration: (pending: boolean) =>
    set({pendingAutoRegistration: pending}),
}))
