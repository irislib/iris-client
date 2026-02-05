import {persist} from "zustand/middleware"
import {create} from "zustand"

interface MessagesState {
  enablePublicChats: boolean
  sendDeliveryReceipts: boolean
  sendReadReceipts: boolean
  hasHydrated: boolean
  setEnablePublicChats: (enable: boolean) => void
  setSendDeliveryReceipts: (enabled: boolean) => void
  setSendReadReceipts: (enabled: boolean) => void
  awaitHydration: () => Promise<void>
}

let resolveHydration: (() => void) | null = null
let hydrationPromise: Promise<void> | null = null

export const useMessagesStore = create<MessagesState>()(
  persist(
    (set, get) => ({
      enablePublicChats: false,
      sendDeliveryReceipts: true,
      sendReadReceipts: true,
      hasHydrated: false,
      setEnablePublicChats: (enablePublicChats: boolean) => set({enablePublicChats}),
      setSendDeliveryReceipts: (sendDeliveryReceipts: boolean) => set({sendDeliveryReceipts}),
      setSendReadReceipts: (sendReadReceipts: boolean) => set({sendReadReceipts}),
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
      partialize: (state) => ({
        enablePublicChats: state.enablePublicChats,
        sendDeliveryReceipts: state.sendDeliveryReceipts,
        sendReadReceipts: state.sendReadReceipts,
      }),
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
