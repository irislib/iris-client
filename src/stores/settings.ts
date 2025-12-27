/* eslint-disable @typescript-eslint/no-explicit-any */
import {persist} from "zustand/middleware"
import {create} from "zustand"
import localforage from "localforage"

export interface SettingsState {
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
    vidproxyUrl: string
    key: string
    salt: string
    enabled: boolean
    fallbackToOriginal: boolean
  }
  // Notification settings
  notifications: {
    server: string
    preferences: {
      mentions: boolean
      replies: boolean
      reposts: boolean
      reactions: boolean
      zaps: boolean
      dms: boolean
    }
  }
  // Network settings
  network: {
    negentropyEnabled: boolean
  }
  // Desktop settings
  desktop: {
    startOnBoot: boolean
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
  updateNetwork: (settings: Partial<SettingsState["network"]>) => void
  updateDesktop: (settings: Partial<SettingsState["desktop"]>) => void
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
        showReactionCounts: true,
        showReactionCountsInStandalone: true, // Always show in post view by default
        hideReactionsBarInStandalone: false, // Hide reactions bar in standalone posts
        hideZapsBarInStandalone: false, // Hide zaps bar in standalone posts
      },
      imgproxy: {
        url: "",
        vidproxyUrl: "",
        key: "",
        salt: "",
        enabled: true,
        fallbackToOriginal: true,
      },
      notifications: {
        server: CONFIG.defaultSettings.notificationServer,
        preferences: {
          mentions: true,
          replies: true,
          reposts: true,
          reactions: true,
          zaps: true,
          dms: true,
        },
      },
      network: {
        negentropyEnabled: false,
      },
      desktop: {
        startOnBoot: true,
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
      updateNetwork: (settings) =>
        set((state) => ({
          network: {...state.network, ...settings},
        })),
      updateDesktop: (settings) =>
        set((state) => ({
          desktop: {...state.desktop, ...settings},
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
        // Migrate old settings without preferences
        if (state?.notifications && !state.notifications.preferences) {
          state.notifications.preferences = {
            mentions: true,
            replies: true,
            reposts: true,
            reactions: true,
            zaps: true,
            dms: true,
          }
        }
        // Migrate old settings without network config
        if (state && !state.network) {
          state.network = {
            negentropyEnabled: false,
          }
        }
        // Clean up deprecated WebRTC settings
        if (state?.network) {
          const network = state.network as any
          delete network.webrtcEnabled
          delete network.webrtcMaxOutbound
          delete network.webrtcMaxInbound
          delete network.webrtcConnectToOwnDevices
          delete network.p2pOnlyMode
          delete network.webrtcCallsEnabled
          delete network.webrtcFileReceivingEnabled
          delete network.useWorkerTransport
          delete network.webrtcLogLevel
          if (state.network.negentropyEnabled === undefined) {
            state.network.negentropyEnabled = false
          }
        }
      },
    }
  )
)
