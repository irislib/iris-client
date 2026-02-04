import {persist} from "zustand/middleware"
import {create} from "zustand"

interface MessagesState {
  enablePublicChats: boolean
  hasHydrated: boolean
  setEnablePublicChats: (enable: boolean) => void
  awaitHydration: () => Promise<void>
}

let resolveHydration: (() => void) | null = null
let hydrationPromise: Promise<void> | null = null

export const useMessagesStore = create<MessagesState>()(
  persist(
    (set, get) => ({
      enablePublicChats: false,
      hasHydrated: false,
      setEnablePublicChats: (enablePublicChats: boolean) => set({enablePublicChats}),
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
      name: "messages-storage",
      partialize: (state) => ({enablePublicChats: state.enablePublicChats}),
      onRehydrateStorage: () => (state) => {
        if (!state) return
        state.hasHydrated = true
        if (resolveHydration) {
          resolveHydration()
          resolveHydration = null
          hydrationPromise = null
        }
      },
    }
  )
)
