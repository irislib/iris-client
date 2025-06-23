import {persist} from "zustand/middleware"
import {create} from "zustand"

const BLOSSOM_IRIS_TO = "https://blossom.iris.to"

type MediaServerProtocol = "blossom" | "nip96"

interface MediaServer {
  url: string
  protocol: MediaServerProtocol
  isDefault?: boolean
}

interface UserState {
  publicKey: string
  privateKey: string

  nip07Login: boolean

  DHTPublicKey: string
  DHTPrivateKey: string

  relays: string[]
  mediaservers: MediaServer[]
  defaultMediaserver: MediaServer | null

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
  setMediaservers: (mediaservers: MediaServer[]) => void
  setDefaultMediaserver: (server: MediaServer) => void
  addMediaserver: (server: MediaServer) => void
  removeMediaserver: (url: string) => void
  setWalletConnect: (walletConnect: boolean) => void
  setCashuEnabled: (cashuEnabled: boolean) => void
  setDefaultZapAmount: (defaultZapAmount: number) => void
  reset: () => void
  ensureDefaultMediaserver: (isSubscriber: boolean) => void
}

export const useUserStore = create<UserState>()(
  persist(
    (set) => {
      const DEFAULT_NIP96_SERVER = {
        url: "https://nostr.build/api/v2/nip96/upload",
        protocol: "nip96" as const,
        isDefault: true,
      }

      const DEFAULT_BLOSSOM_SERVER = {
        url: BLOSSOM_IRIS_TO,
        protocol: "blossom" as const,
        isDefault: true,
      }

      const initialState = {
        publicKey: "",
        privateKey: "",
        nip07Login: false,
        DHTPublicKey: "",
        DHTPrivateKey: "",
        relays: [],
        mediaservers: [],
        defaultMediaserver: null,
        walletConnect: false,
        cashuEnabled: false,
        defaultZapAmount: 21,
        hasHydrated: false,
      }

      const actions = {
        setPublicKey: (publicKey: string) => set({publicKey}),
        setPrivateKey: (privateKey: string) => set({privateKey}),
        setNip07Login: (nip07Login: boolean) => set({nip07Login}),
        setDHTPublicKey: (DHTPublicKey: string) => set({DHTPublicKey}),
        setDHTPrivateKey: (DHTPrivateKey: string) => set({DHTPrivateKey}),
        setRelays: (relays: string[]) => set({relays}),
        setMediaservers: (mediaservers: MediaServer[]) => set({mediaservers}),
        setDefaultMediaserver: (server: MediaServer) => set({defaultMediaserver: server}),
        addMediaserver: (server: MediaServer) =>
          set((state) => ({
            mediaservers: [...new Set([...state.mediaservers, server])],
          })),
        removeMediaserver: (url: string) =>
          set((state) => ({
            mediaservers: state.mediaservers.filter((s) => s.url !== url),
          })),
        setWalletConnect: (walletConnect: boolean) => set({walletConnect}),
        setCashuEnabled: (cashuEnabled: boolean) => set({cashuEnabled}),
        setDefaultZapAmount: (defaultZapAmount: number) => set({defaultZapAmount}),
        reset: () => set(initialState),
        ensureDefaultMediaserver: (isSubscriber: boolean) =>
          set((state) => {
            if (!state.defaultMediaserver) {
              const server = isSubscriber ? DEFAULT_BLOSSOM_SERVER : DEFAULT_NIP96_SERVER
              return {
                mediaservers: [server],
                defaultMediaserver: server,
              }
            }
            return {}
          }),
      }

      return {
        ...initialState,
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
export const useMediaservers = () => useUserStore((state) => state.mediaservers)
export const useDefaultMediaserver = () =>
  useUserStore((state) => state.defaultMediaserver)
export const useWalletConnect = () => useUserStore((state) => state.walletConnect)
export const useCashuEnabled = () => useUserStore((state) => state.cashuEnabled)
export const useDefaultZapAmount = () => useUserStore((state) => state.defaultZapAmount)
export const useReset = () => useUserStore((state) => state.reset)
