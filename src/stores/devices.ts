import {create} from "zustand"
import type {DeviceEntry} from "nostr-double-ratchet/src"

export type SetupStatus =
  | "not_started"
  | "initializing"
  | "ready_to_register"
  | "registered"

interface DeviceState {
  identityPubkey: string | null
  ownerPubkey: string | null
  isActivated: boolean
  registeredDevices: DeviceEntry[]
  isCurrentDeviceRegistered: boolean
  setupStatus: SetupStatus
  setupError: string | null
  onboardingDismissed: boolean
  appKeysManagerReady: boolean
  sessionManagerReady: boolean
  hasLocalAppKeys: boolean
  lastEventTimestamp: number // Track last processed AppKeys event timestamp
  // Computed
  canSendPrivateMessages: boolean
  // Actions
  setIdentityPubkey: (pubkey: string) => void
  setOwnerPubkey: (pubkey: string) => void
  setActivated: (activated: boolean) => void
  setRegisteredDevices: (devices: DeviceEntry[], timestamp?: number) => void
  setSetupStatus: (status: SetupStatus) => void
  setSetupError: (error: string | null) => void
  setOnboardingDismissed: (dismissed: boolean) => void
  setAppKeysManagerReady: (ready: boolean) => void
  setSessionManagerReady: (ready: boolean) => void
  setHasLocalAppKeys: (has: boolean) => void
  reset: () => void
}

const initialState = {
  identityPubkey: null,
  ownerPubkey: null,
  isActivated: false,
  registeredDevices: [],
  isCurrentDeviceRegistered: false,
  setupStatus: "not_started" as SetupStatus,
  setupError: null,
  onboardingDismissed: false,
  appKeysManagerReady: false,
  sessionManagerReady: false,
  hasLocalAppKeys: false,
  lastEventTimestamp: 0,
  canSendPrivateMessages: false,
}

const computeCanSendPrivateMessages = (
  appKeysManagerReady: boolean,
  sessionManagerReady: boolean,
  hasLocalAppKeys: boolean,
  isCurrentDeviceRegistered: boolean
): boolean => {
  // Can send if AppKeysManager ready AND SessionManager ready AND (has local AppKeys OR device is registered)
  return (
    appKeysManagerReady &&
    sessionManagerReady &&
    (hasLocalAppKeys || isCurrentDeviceRegistered)
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
        isCurrentDeviceRegistered
      ),
    })
  },
  setOwnerPubkey: (pubkey: string) => set({ownerPubkey: pubkey}),
  setActivated: (activated: boolean) => set({isActivated: activated}),
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
        isCurrentDeviceRegistered
      ),
    })
  },
  setSetupStatus: (status: SetupStatus) => set({setupStatus: status}),
  setSetupError: (error: string | null) => set({setupError: error}),
  setOnboardingDismissed: (dismissed: boolean) => set({onboardingDismissed: dismissed}),
  setAppKeysManagerReady: (ready: boolean) => {
    const {sessionManagerReady, hasLocalAppKeys, isCurrentDeviceRegistered} = get()
    set({
      appKeysManagerReady: ready,
      canSendPrivateMessages: computeCanSendPrivateMessages(
        ready,
        sessionManagerReady,
        hasLocalAppKeys,
        isCurrentDeviceRegistered
      ),
    })
  },
  setSessionManagerReady: (ready: boolean) => {
    const {appKeysManagerReady, hasLocalAppKeys, isCurrentDeviceRegistered} = get()
    set({
      sessionManagerReady: ready,
      canSendPrivateMessages: computeCanSendPrivateMessages(
        appKeysManagerReady,
        ready,
        hasLocalAppKeys,
        isCurrentDeviceRegistered
      ),
    })
  },
  setHasLocalAppKeys: (has: boolean) => {
    const {appKeysManagerReady, sessionManagerReady, isCurrentDeviceRegistered} = get()
    set({
      hasLocalAppKeys: has,
      canSendPrivateMessages: computeCanSendPrivateMessages(
        appKeysManagerReady,
        sessionManagerReady,
        has,
        isCurrentDeviceRegistered
      ),
    })
  },
  reset: () => set(initialState),
}))
