import {persist} from "zustand/middleware"
import {create} from "zustand"

interface UserState {
  publicKey: string
  privateKey: string

  nip07Login: boolean

  DHTPublicKey: string
  DHTPrivateKey: string

  relays: string[]
  mediaserver: string

  walletConnect: boolean
  cashuEnabled: boolean
  defaultZapAmount: number

  hasHydrated: boolean

  setPublicKey: (publicKey: string) => void
  setPrivateKey: (privateKey: string) => void
  setNip07Login: (nip07Login: boolean) => void
  setDHTPublicKey: (DHTPublicKey: string) => void
  setDHTPrivateKey: (DHTPrivateKey: string) => void
  setRelays: (relays: string[]) => void
  setMediaserver: (mediaserver: string) => void
  setWalletConnect: (walletConnect: boolean) => void
  setCashuEnabled: (cashuEnabled: boolean) => void
  setDefaultZapAmount: (defaultZapAmount: number) => void

  reset: () => void
}

const migrateFromLocalStorage = <T>(key: string, defaultValue: T): T => {
  try {
    const storedValue = localStorage.getItem(`localState/${key}`)
    if (storedValue) {
      try {
        const parsedValue = JSON.parse(storedValue)
        const extractedValue =
          parsedValue && typeof parsedValue === "object" && "value" in parsedValue
            ? parsedValue.value
            : parsedValue

        console.log(`Migrated ${key} from localStorage:`, extractedValue)
        // Clean up old storage after successful migration
        localStorage.removeItem(`localState/${key}`)
        return extractedValue
      } catch (error) {
        console.error(`Error parsing ${key} from localStorage:`, error)
      }
    }
  } catch (error) {
    console.error(`Error migrating ${key} from localStorage:`, error)
  }
  return defaultValue
}

export const useUserStore = create<UserState>()(
  persist(
    (set) => {
      // Initialize with default values first
      const initialState = {
        publicKey: "",
        privateKey: "",
        nip07Login: false,
        DHTPublicKey: "",
        DHTPrivateKey: "",
        relays: [],
        mediaserver: "",
        walletConnect: false,
        cashuEnabled: false,
        defaultZapAmount: 21,
        hasHydrated: false,
      }

      // Perform migration after store is created
      const migratedState = {
        publicKey: migrateFromLocalStorage("user/publicKey", initialState.publicKey),
        privateKey: migrateFromLocalStorage("user/privateKey", initialState.privateKey),
        nip07Login: migrateFromLocalStorage("user/nip07Login", initialState.nip07Login),
        DHTPublicKey: migrateFromLocalStorage(
          "user/DHTPublicKey",
          initialState.DHTPublicKey
        ),
        DHTPrivateKey: migrateFromLocalStorage(
          "user/DHTPrivateKey",
          initialState.DHTPrivateKey
        ),
        relays: migrateFromLocalStorage("user/relays", initialState.relays),
        mediaserver: migrateFromLocalStorage(
          "user/mediaserver",
          initialState.mediaserver
        ),
        walletConnect: migrateFromLocalStorage(
          "user/walletConnect",
          initialState.walletConnect
        ),
        cashuEnabled: migrateFromLocalStorage(
          "user/cashuEnabled",
          initialState.cashuEnabled
        ),
        defaultZapAmount: migrateFromLocalStorage(
          "user/defaultZapAmount",
          initialState.defaultZapAmount
        ),
      }

      // Set initial state with migrated values
      set(migratedState)

      // Define actions
      const actions = {
        setPublicKey: (publicKey: string) => set({publicKey}),
        setPrivateKey: (privateKey: string) => set({privateKey}),
        setNip07Login: (nip07Login: boolean) => set({nip07Login}),
        setDHTPublicKey: (DHTPublicKey: string) => set({DHTPublicKey}),
        setDHTPrivateKey: (DHTPrivateKey: string) => set({DHTPrivateKey}),
        setRelays: (relays: string[]) => set({relays}),
        setMediaserver: (mediaserver: string) => set({mediaserver}),
        setWalletConnect: (walletConnect: boolean) => set({walletConnect}),
        setCashuEnabled: (cashuEnabled: boolean) => set({cashuEnabled}),
        setDefaultZapAmount: (defaultZapAmount: number) => set({defaultZapAmount}),
        reset: () => set(initialState),
      }

      // Return combined state and actions
      return {
        ...migratedState,
        hasHydrated: false,
        ...actions,
      }
    },
    {
      name: "user-storage",
      onRehydrateStorage: () => (state) => {
        if (state) {
          state.hasHydrated = true
        }
      },
    }
  )
)

export const usePublicKey = () => useUserStore((state) => state.publicKey)
export const usePrivateKey = () => useUserStore((state) => state.privateKey)
export const useNip07Login = () => useUserStore((state) => state.nip07Login)
export const useRelays = () => useUserStore((state) => state.relays)
export const useWalletConnect = () => useUserStore((state) => state.walletConnect)
export const useCashuEnabled = () => useUserStore((state) => state.cashuEnabled)
export const useDefaultZapAmount = () => useUserStore((state) => state.defaultZapAmount)
