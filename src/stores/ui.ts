import {persist} from "zustand/middleware"
import {create} from "zustand"

interface UIState {
  isSidebarOpen: boolean
  newPostOpen: boolean
  showLoginDialog: boolean
  goToNotifications: number
  hidePWAPrompt: boolean

  setIsSidebarOpen: (isOpen: boolean) => void
  setNewPostOpen: (isOpen: boolean) => void
  setShowLoginDialog: (isOpen: boolean) => void
  incrementGoToNotifications: () => void
  setHidePWAPrompt: (hide: boolean) => void
}

export const useUIStore = create<UIState>()(
  persist(
    (set, get) => {
      const initialState = {
        isSidebarOpen: false,
        newPostOpen: false,
        showLoginDialog: false,
        goToNotifications: 0,
        hidePWAPrompt: false,
      }

      const actions = {
        setIsSidebarOpen: (isSidebarOpen: boolean) => set({isSidebarOpen}),
        setNewPostOpen: (newPostOpen: boolean) => set({newPostOpen}),
        setShowLoginDialog: (showLoginDialog: boolean) => set({showLoginDialog}),
        incrementGoToNotifications: () =>
          set({goToNotifications: get().goToNotifications + 1}),
        setHidePWAPrompt: (hidePWAPrompt: boolean) => set({hidePWAPrompt}),
      }

      return {
        ...initialState,
        ...actions,
      }
    },
    {
      name: "ui-storage",
    }
  )
)

export const useIsSidebarOpen = () => useUIStore((state) => state.isSidebarOpen)
export const useNewPostOpen = () => useUIStore((state) => state.newPostOpen)
export const useShowLoginDialog = () => useUIStore((state) => state.showLoginDialog)
export const useGoToNotifications = () => useUIStore((state) => state.goToNotifications)
export const useHidePWAPrompt = () => useUIStore((state) => state.hidePWAPrompt)
