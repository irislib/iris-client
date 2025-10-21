import {persist} from "zustand/middleware"
import {create} from "zustand"
import localforage from "localforage"
import {isTouchDevice} from "@/shared/utils/isTouchDevice"

interface SettingsState {
  // Appearance settings
  appearance: {
    theme: string
    showRightColumn: boolean
    singleColumnLayout: boolean
    limitedMaxWidth: boolean
  }
  // Content settings
  content: {
    blurNSFW: boolean
    maxFollowDistanceForReplies: number | undefined // 1=followed, 2=friends of friends, 3-5=extended network, undefined=unlimited
    hidePostsByMutedMoreThanFollowed: boolean
    autoplayVideos: boolean
    showLikes: boolean
    showReposts: boolean
    showReplies: boolean
    showZaps: boolean
    showReactionsBar: boolean
    showReactionCounts: boolean
    showReactionCountsInStandalone: boolean
    hideReactionsBarInStandalone: boolean
    hideZapsBarInStandalone: boolean
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
  // Debug settings
  debug: {
    enabled: boolean
    privateKey: string | null
  }
  // Legal settings
  legal: {
    tosAccepted: boolean
    tosAcceptedVersion: number
  }
  // Update a specific setting group
  updateAppearance: (settings: Partial<SettingsState["appearance"]>) => void
  updateContent: (settings: Partial<SettingsState["content"]>) => void
  updateImgproxy: (settings: Partial<SettingsState["imgproxy"]>) => void
  updateNotifications: (settings: Partial<SettingsState["notifications"]>) => void
  updateDebug: (settings: Partial<SettingsState["debug"]>) => void
  updateLegal: (settings: Partial<SettingsState["legal"]>) => void
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      appearance: {
        theme: CONFIG.defaultTheme,
        showRightColumn: true,
        singleColumnLayout: true,
        limitedMaxWidth: false,
      },
      content: {
        blurNSFW: true,
        maxFollowDistanceForReplies: 5, // Default to 5
        hidePostsByMutedMoreThanFollowed: true,
        autoplayVideos: true,
        showLikes: true,
        showReposts: true,
        showReplies: true,
        showZaps: true,
        showReactionsBar: true,
        showReactionCounts: !isTouchDevice, // Hide in feed on mobile by default
        showReactionCountsInStandalone: true, // Always show in post view by default
        hideReactionsBarInStandalone: false, // Hide reactions bar in standalone posts
        hideZapsBarInStandalone: false, // Hide zaps bar in standalone posts
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
      debug: {
        enabled: false,
        privateKey: null,
      },
      legal: {
        tosAccepted: false,
        tosAcceptedVersion: 0,
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
      updateDebug: (settings) =>
        set((state) => ({
          debug: {...state.debug, ...settings},
        })),
      updateLegal: (settings) =>
        set((state) => ({
          legal: {...state.legal, ...settings},
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
