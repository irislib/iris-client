import {persist} from "zustand/middleware"
import {create} from "zustand"
import type {GetInfoResponse} from "@cashu/cashu-ts"

type Tab = "history" | "mints"

interface CachedMintInfo {
  info: GetInfoResponse
  timestamp: number
}

interface CashuWalletState {
  expandHistory: boolean
  activeTab: Tab
  activeMint: string | null
  mintInfoCache: {[url: string]: CachedMintInfo}

  setExpandHistory: (expand: boolean) => void
  toggleExpandHistory: () => void
  setActiveTab: (tab: Tab) => void
  setActiveMint: (mintUrl: string) => void
  setCachedMintInfo: (url: string, info: GetInfoResponse) => void
  getCachedMintInfo: (url: string, maxAgeMs?: number) => GetInfoResponse | null
  clearMintInfoCache: (url?: string) => void
}

export const useCashuWalletStore = create<CashuWalletState>()(
  persist(
    (set) => {
      const initialState = {
        expandHistory: false,
        activeTab: "history" as Tab,
        activeMint: null as string | null,
        mintInfoCache: {} as {[url: string]: CachedMintInfo},
      }

      const actions = {
        setExpandHistory: (expand: boolean) => set({expandHistory: expand}),
        toggleExpandHistory: () =>
          set((state) => ({expandHistory: !state.expandHistory})),
        setActiveTab: (tab: Tab) => set({activeTab: tab}),
        setActiveMint: (mintUrl: string) => set({activeMint: mintUrl}),
        setCachedMintInfo: (url: string, info: GetInfoResponse) =>
          set((state) => ({
            mintInfoCache: {
              ...state.mintInfoCache,
              [url]: {info, timestamp: Date.now()},
            },
          })),
        getCachedMintInfo: (url: string, maxAgeMs = 24 * 60 * 60 * 1000) => {
          const state = useCashuWalletStore.getState()
          const cached = state.mintInfoCache[url]
          if (!cached) return null
          const age = Date.now() - cached.timestamp
          if (age > maxAgeMs) return null
          return cached.info
        },
        clearMintInfoCache: (url?: string) =>
          set((state) => {
            if (url) {
              const {[url]: _removed, ...rest} = state.mintInfoCache
              return {mintInfoCache: rest}
            }
            return {mintInfoCache: {}}
          }),
      }

      return {
        ...initialState,
        ...actions,
      }
    },
    {
      name: "cashu-wallet-storage",
    }
  )
)
