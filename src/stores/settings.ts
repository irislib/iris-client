import {persist} from "zustand/middleware"
import {create} from "zustand"

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
  }
  // Notification settings
  notifications: {
    server: string
  }
  // Privacy settings
  privacy: {
    enableAnalytics: boolean
  }
  // Update a specific setting group
  updateAppearance: (settings: Partial<SettingsState["appearance"]>) => void
  updateContent: (settings: Partial<SettingsState["content"]>) => void
  updateNotifications: (settings: Partial<SettingsState["notifications"]>) => void
  updatePrivacy: (settings: Partial<SettingsState["privacy"]>) => void
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
      },
      notifications: {
        server: CONFIG.defaultSettings.notificationServer,
      },
      privacy: {
        enableAnalytics: true,
      },
      updateAppearance: (settings) =>
        set((state) => ({
          appearance: {...state.appearance, ...settings},
        })),
      updateContent: (settings) =>
        set((state) => ({
          content: {...state.content, ...settings},
        })),
      updateNotifications: (settings) =>
        set((state) => ({
          notifications: {...state.notifications, ...settings},
        })),
      updatePrivacy: (settings) =>
        set((state) => ({
          privacy: {...state.privacy, ...settings},
        })),
    }),
    {
      name: "settings-storage",
    }
  )
)
