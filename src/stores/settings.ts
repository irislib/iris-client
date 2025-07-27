import {persist} from "zustand/middleware"
import {create} from "zustand"
import localforage from "localforage"
import {CONFIG} from "@/utils/config"

interface SettingsState {
  // Appearance settings
  appearance: {
    theme: string
  }
  // Content settings
  content: {
    blurNSFW: boolean
    hideEventsByUnknownUsers: boolean
    hidePostsByMutedMoreThanFollowed: boolean
    autoplayVideos: boolean
    showLikes: boolean
    showReposts: boolean
    showReplies: boolean
    showZaps: boolean
    showReactionsBar: boolean
    showReactionCounts: boolean
  }
  // Imgproxy settings
  imgproxy: {
    url: string
    key: string
    salt: string
    enabled: boolean
    fallbackToOriginal: boolean
  }
  // Notification settings
  notifications: {
    server: string
  }
  // Privacy settings
  privacy: {
    enableAnalytics: boolean
  }
  // Debug settings
  debug: {
    enabled: boolean
    privateKey: string | null
  }
  // Update a specific setting group
  updateAppearance: (settings: Partial<SettingsState["appearance"]>) => void
  updateContent: (settings: Partial<SettingsState["content"]>) => void
  updateImgproxy: (settings: Partial<SettingsState["imgproxy"]>) => void
  updateNotifications: (settings: Partial<SettingsState["notifications"]>) => void
  updatePrivacy: (settings: Partial<SettingsState["privacy"]>) => void
  updateDebug: (settings: Partial<SettingsState["debug"]>) => void
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      appearance: {
        theme: CONFIG.defaultTheme,
      },
      content: {
        blurNSFW: true,
        hideEventsByUnknownUsers: true,
        hidePostsByMutedMoreThanFollowed: true,
        autoplayVideos: true,
        showLikes: true,
        showReposts: true,
        showReplies: true,
        showZaps: true,
        showReactionsBar: true,
        showReactionCounts: true,
      },
      imgproxy: {
        url: "https://imgproxy.coracle.social",
        key: "",
        salt: "",
        enabled: true,
        fallbackToOriginal: true,
      },
      notifications: {
        server: CONFIG.defaultSettings.notificationServer,
      },
      privacy: {
        enableAnalytics: true,
      },
      debug: {
        enabled: false,
        privateKey: null,
      },
      updateAppearance: (settings) =>
        set((state) => ({
          appearance: {...state.appearance, ...settings},
        })),
      updateContent: (settings) =>
        set((state) => ({
          content: {...state.content, ...settings},
        })),
      updateImgproxy: (settings) =>
        set((state) => {
          const newImgproxy = {...state.imgproxy, ...settings}
          localforage.setItem("imgproxy-settings", newImgproxy)
          return {imgproxy: newImgproxy}
        }),
      updateNotifications: (settings) =>
        set((state) => ({
          notifications: {...state.notifications, ...settings},
        })),
      updatePrivacy: (settings) =>
        set((state) => ({
          privacy: {...state.privacy, ...settings},
        })),
      updateDebug: (settings) =>
        set((state) => ({
          debug: {...state.debug, ...settings},
        })),
    }),
    {
      name: "settings-storage",
      onRehydrateStorage: () => (state) => {
        if (state?.imgproxy) {
          localforage.setItem("imgproxy-settings", state.imgproxy)
        }
      },
    }
  )
)
