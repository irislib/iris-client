import {create} from "zustand"
import {evaluateDeviceRegistrationState, type DeviceEntry} from "nostr-double-ratchet"

interface DeviceState {
  identityPubkey: string | null
  registeredDevices: DeviceEntry[]
  isCurrentDeviceRegistered: boolean
  appKeysManagerReady: boolean
  sessionManagerReady: boolean
  hasLocalAppKeys: boolean
  lastEventTimestamp: number // Track last processed AppKeys event timestamp
  pendingAutoRegistration: boolean
  privateMessagingBlocked: boolean
  // Computed
  canSendPrivateMessages: boolean
  // Actions
  setIdentityPubkey: (pubkey: string) => void
  setRegisteredDevices: (devices: DeviceEntry[], timestamp?: number) => void
  setAppKeysManagerReady: (ready: boolean) => void
  setSessionManagerReady: (ready: boolean) => void
  setHasLocalAppKeys: (has: boolean) => void
  setPendingAutoRegistration: (pending: boolean) => void
  setPrivateMessagingBlocked: (blocked: boolean) => void
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
  privateMessagingBlocked: false,
  canSendPrivateMessages: false,
}

const currentDeviceRemovalListeners = new Set<(pubkey: string) => void>()

const computeDeviceRegistrationState = (state: {
  identityPubkey: string | null
  registeredDevices: DeviceEntry[]
  appKeysManagerReady: boolean
  sessionManagerReady: boolean
  hasLocalAppKeys: boolean
}) => {
  return evaluateDeviceRegistrationState({
    currentDevicePubkey: state.identityPubkey,
    registeredDevices: state.registeredDevices,
    hasLocalAppKeys: state.hasLocalAppKeys,
    appKeysManagerReady: state.appKeysManagerReady,
    sessionManagerReady: state.sessionManagerReady,
  })
}

export const useDevicesStore = create<DeviceState>()((set, get) => ({
  ...initialState,
  setIdentityPubkey: (pubkey: string) => {
    const {registeredDevices, appKeysManagerReady, sessionManagerReady, hasLocalAppKeys} =
      get()
    const nextState = computeDeviceRegistrationState({
      identityPubkey: pubkey,
      registeredDevices,
      appKeysManagerReady,
      sessionManagerReady,
      hasLocalAppKeys,
    })
    set({
      identityPubkey: pubkey,
      isCurrentDeviceRegistered: nextState.isCurrentDeviceRegistered,
      canSendPrivateMessages: nextState.canSendPrivateMessages,
    })
  },
  setRegisteredDevices: (devices: DeviceEntry[], timestamp?: number) => {
    const {
      identityPubkey,
      registeredDevices,
      appKeysManagerReady,
      sessionManagerReady,
      hasLocalAppKeys,
      lastEventTimestamp,
    } = get()
    // Same-second AppKeys updates are valid; only strictly older events are stale.
    if (timestamp !== undefined && timestamp < lastEventTimestamp) {
      return // Skip older events
    }
    const nextState = computeDeviceRegistrationState({
      identityPubkey,
      registeredDevices: devices,
      appKeysManagerReady,
      sessionManagerReady,
      hasLocalAppKeys,
    })
    set({
      registeredDevices: devices,
      isCurrentDeviceRegistered: nextState.isCurrentDeviceRegistered,
      lastEventTimestamp: timestamp ?? lastEventTimestamp,
      canSendPrivateMessages: nextState.canSendPrivateMessages,
    })
    const removedCurrentDevice =
      identityPubkey &&
      registeredDevices.some((device) => device.identityPubkey === identityPubkey) &&
      !devices.some((device) => device.identityPubkey === identityPubkey)
    if (removedCurrentDevice) {
      for (const listener of currentDeviceRemovalListeners) listener(identityPubkey)
    }
  },
  setAppKeysManagerReady: (ready: boolean) => {
    const {sessionManagerReady, hasLocalAppKeys, identityPubkey, registeredDevices} =
      get()
    const nextState = computeDeviceRegistrationState({
      identityPubkey,
      registeredDevices,
      appKeysManagerReady: ready,
      sessionManagerReady,
      hasLocalAppKeys,
    })
    set({
      appKeysManagerReady: ready,
      canSendPrivateMessages: nextState.canSendPrivateMessages,
    })
  },
  setSessionManagerReady: (ready: boolean) => {
    const {appKeysManagerReady, hasLocalAppKeys, identityPubkey, registeredDevices} =
      get()
    const nextState = computeDeviceRegistrationState({
      identityPubkey,
      registeredDevices,
      appKeysManagerReady,
      sessionManagerReady: ready,
      hasLocalAppKeys,
    })
    set({
      sessionManagerReady: ready,
      canSendPrivateMessages: nextState.canSendPrivateMessages,
    })
  },
  setHasLocalAppKeys: (has: boolean) => {
    const {appKeysManagerReady, sessionManagerReady, identityPubkey, registeredDevices} =
      get()
    const nextState = computeDeviceRegistrationState({
      identityPubkey,
      registeredDevices,
      appKeysManagerReady,
      sessionManagerReady,
      hasLocalAppKeys: has,
    })
    set({
      hasLocalAppKeys: has,
      canSendPrivateMessages: nextState.canSendPrivateMessages,
    })
  },
  setPendingAutoRegistration: (pending: boolean) =>
    set({pendingAutoRegistration: pending}),
  setPrivateMessagingBlocked: (privateMessagingBlocked: boolean) =>
    set({privateMessagingBlocked}),
}))

export const onCurrentDeviceRemovedFromRoster = (
  listener: (pubkey: string) => void
): (() => void) => {
  currentDeviceRemovalListeners.add(listener)
  return () => currentDeviceRemovalListeners.delete(listener)
}
