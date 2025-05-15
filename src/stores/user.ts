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

const migrateFromLocalStorage = (key: string, defaultValue: any): any => {
  try {
    const storedValue = localStorage.getItem(`localState/${key}`)
    if (storedValue) {
      try {
        const parsedValue = JSON.parse(storedValue)
        const extractedValue = parsedValue && typeof parsedValue === 'object' && 'value' in parsedValue 
          ? parsedValue.value 
          : parsedValue
        
        console.log(`Migrated ${key} from localStorage:`, extractedValue)
        
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
    (set) => ({
      publicKey: migrateFromLocalStorage("user/publicKey", ""),
      privateKey: migrateFromLocalStorage("user/privateKey", ""),
      nip07Login: migrateFromLocalStorage("user/nip07Login", false),
      DHTPublicKey: migrateFromLocalStorage("user/DHTPublicKey", ""),
      DHTPrivateKey: migrateFromLocalStorage("user/DHTPrivateKey", ""),
      relays: migrateFromLocalStorage("user/relays", []),
      mediaserver: migrateFromLocalStorage("user/mediaserver", ""),
      walletConnect: migrateFromLocalStorage("user/walletConnect", false),
      cashuEnabled: migrateFromLocalStorage("user/cashuEnabled", false),
      defaultZapAmount: migrateFromLocalStorage("user/defaultZapAmount", 21),
      hasHydrated: false,
      
      setPublicKey: (publicKey) => set({publicKey}),
      setPrivateKey: (privateKey) => set({privateKey}),
      setNip07Login: (nip07Login) => set({nip07Login}),
      setDHTPublicKey: (DHTPublicKey) => set({DHTPublicKey}),
      setDHTPrivateKey: (DHTPrivateKey) => set({DHTPrivateKey}),
      setRelays: (relays) => set({relays}),
      setMediaserver: (mediaserver) => set({mediaserver}),
      setWalletConnect: (walletConnect) => set({walletConnect}),
      setCashuEnabled: (cashuEnabled) => set({cashuEnabled}),
      setDefaultZapAmount: (defaultZapAmount) => set({defaultZapAmount}),
      
      reset: () => set({
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
      }),
    }),
    {
      name: "user-storage", // Name for localStorage
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
