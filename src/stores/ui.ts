import {persist} from "zustand/middleware"
import {create} from "zustand"

interface UIState {
  newPostOpen: boolean
  showLoginDialog: boolean
  goToNotifications: number
  hidePWAPrompt: boolean
  isMediaModalSidebarVisible: boolean
  showRelayIndicator: boolean
  navItemClicked: {signal: number; path: string}
  chatsListActiveTab: "all" | "requests"
  marketDisplayAs: "list" | "grid"
  mapDisplayAs: "list" | "grid"

  setNewPostOpen: (isOpen: boolean) => void
  setShowLoginDialog: (isOpen: boolean) => void
  incrementGoToNotifications: () => void
  setHidePWAPrompt: (hide: boolean) => void
  setMediaModalSidebarVisible: (isVisible: boolean) => void
  setShowRelayIndicator: (show: boolean) => void
  triggerNavItemClick: (path: string) => void
  setChatsListActiveTab: (tab: "all" | "requests") => void
  setMarketDisplayAs: (displayAs: "list" | "grid") => void
  setMapDisplayAs: (displayAs: "list" | "grid") => void
}

export const useUIStore = create<UIState>()(
  persist(
    (set, get) => {
      const initialState = {
        newPostOpen: false,
        showLoginDialog: false,
        goToNotifications: 0,
        hidePWAPrompt: false,
        isMediaModalSidebarVisible: true,
        showRelayIndicator: true,
        navItemClicked: {signal: 0, path: ""},
        chatsListActiveTab: "all" as "all" | "requests",
        marketDisplayAs: "list" as "list" | "grid",
        mapDisplayAs: "list" as "list" | "grid",
      }

      const actions = {
        setNewPostOpen: (newPostOpen: boolean) => set({newPostOpen}),
        setShowLoginDialog: (showLoginDialog: boolean) => set({showLoginDialog}),
        incrementGoToNotifications: () =>
          set({goToNotifications: get().goToNotifications + 1}),
        setHidePWAPrompt: (hidePWAPrompt: boolean) => set({hidePWAPrompt}),
        setMediaModalSidebarVisible: (isMediaModalSidebarVisible: boolean) =>
          set({isMediaModalSidebarVisible}),
        setShowRelayIndicator: (showRelayIndicator: boolean) => set({showRelayIndicator}),
        triggerNavItemClick: (path: string) =>
          set({navItemClicked: {signal: Date.now(), path}}),
        setChatsListActiveTab: (chatsListActiveTab: "all" | "requests") =>
          set({chatsListActiveTab}),
        setMarketDisplayAs: (marketDisplayAs: "list" | "grid") => set({marketDisplayAs}),
        setMapDisplayAs: (mapDisplayAs: "list" | "grid") => set({mapDisplayAs}),
      }

      return {
        ...initialState,
        ...actions,
      }
    },
    {
      name: "ui-storage",
      partialize: (state) => ({
        newPostOpen: state.newPostOpen,
        showLoginDialog: state.showLoginDialog,
        goToNotifications: state.goToNotifications,
        hidePWAPrompt: state.hidePWAPrompt,
        isMediaModalSidebarVisible: state.isMediaModalSidebarVisible,
        showRelayIndicator: state.showRelayIndicator,
        marketDisplayAs: state.marketDisplayAs,
        mapDisplayAs: state.mapDisplayAs,
        // Exclude navItemClicked from persistence
      }),
    }
  )
)

export const useMediaModalSidebarVisible = () =>
  useUIStore((state) => state.isMediaModalSidebarVisible)
