import {persist} from "zustand/middleware"
import {create} from "zustand"
import {hexToBytes} from "@noble/hashes/utils"

export interface DelegateDeviceCredentials {
  devicePublicKey: string
  devicePrivateKey: string // hex
  ephemeralPublicKey: string
  ephemeralPrivateKey: string // hex
  sharedSecret: string
  deviceId: string
  deviceLabel: string
  ownerPublicKey?: string // set after activation
}

interface DelegateDeviceState {
  credentials: DelegateDeviceCredentials | null
  isActivated: boolean
  hasHydrated: boolean

  setCredentials: (credentials: DelegateDeviceCredentials) => void
  setOwnerPublicKey: (ownerPublicKey: string) => void
  setActivated: (activated: boolean) => void
  clear: () => void
  awaitHydration: () => Promise<void>
}

let hydrationPromise: Promise<void> | null = null
let resolveHydration: (() => void) | null = null

export const useDelegateDeviceStore = create<DelegateDeviceState>()(
  persist(
    (set, get) => ({
      credentials: null,
      isActivated: false,
      hasHydrated: false,

      setCredentials: (credentials) => set({credentials}),

      setOwnerPublicKey: (ownerPublicKey) =>
        set((state) => ({
          credentials: state.credentials ? {...state.credentials, ownerPublicKey} : null,
        })),

      setActivated: (activated) => set({isActivated: activated}),

      clear: () => set({credentials: null, isActivated: false}),

      awaitHydration: () => {
        if (get().hasHydrated) return Promise.resolve()
        if (!hydrationPromise) {
          hydrationPromise = new Promise<void>((resolve) => {
            resolveHydration = resolve
          })
        }
        return hydrationPromise
      },
    }),
    {
      name: "delegate-device-storage",
      onRehydrateStorage: () => (state) => {
        if (state) {
          state.hasHydrated = true
          if (resolveHydration) {
            resolveHydration()
            resolveHydration = null
            hydrationPromise = null
          }
        }
      },
    }
  )
)

/**
 * Parse a pairing code (base64 JSON) into credentials
 */
export function parsePairingCode(code: string): DelegateDeviceCredentials {
  const json = atob(code.trim())
  const data = JSON.parse(json)

  // Validate required fields
  const required = [
    "devicePublicKey",
    "devicePrivateKey",
    "ephemeralPublicKey",
    "ephemeralPrivateKey",
    "sharedSecret",
    "deviceId",
    "deviceLabel",
  ]
  for (const field of required) {
    if (!data[field]) {
      throw new Error(`Missing required field: ${field}`)
    }
  }

  return {
    devicePublicKey: data.devicePublicKey,
    devicePrivateKey: data.devicePrivateKey,
    ephemeralPublicKey: data.ephemeralPublicKey,
    ephemeralPrivateKey: data.ephemeralPrivateKey,
    sharedSecret: data.sharedSecret,
    deviceId: data.deviceId,
    deviceLabel: data.deviceLabel,
  }
}

/**
 * Convert stored hex keys back to Uint8Array for SecondaryDeviceManager
 */
export function getDevicePrivateKeyBytes(
  credentials: DelegateDeviceCredentials
): Uint8Array {
  return hexToBytes(credentials.devicePrivateKey)
}

export function getEphemeralPrivateKeyBytes(
  credentials: DelegateDeviceCredentials
): Uint8Array {
  return hexToBytes(credentials.ephemeralPrivateKey)
}
