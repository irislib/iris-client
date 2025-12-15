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
    webrtcEnabled: boolean
    webrtcMaxOutbound: number
    webrtcMaxInbound: number
    webrtcConnectToOwnDevices: boolean
    p2pOnlyMode: boolean
    webrtcCallsEnabled: boolean
    webrtcFileReceivingEnabled: boolean
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
        webrtcEnabled: true,
        webrtcMaxOutbound: 5,
        webrtcMaxInbound: 5,
        webrtcConnectToOwnDevices: true,
        p2pOnlyMode: false,
        webrtcCallsEnabled: true,
        webrtcFileReceivingEnabled: true,
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
            webrtcEnabled: true,
            webrtcMaxOutbound: 5,
            webrtcMaxInbound: 5,
            webrtcConnectToOwnDevices: true,
            p2pOnlyMode: false,
            webrtcCallsEnabled: true,
            webrtcFileReceivingEnabled: true,
            negentropyEnabled: false,
          }
        }
        // Migrate network settings without new fields
        if (state?.network) {
          if (state.network.webrtcMaxOutbound === undefined) {
            state.network.webrtcMaxOutbound = 5
          }
          if (state.network.webrtcMaxInbound === undefined) {
            state.network.webrtcMaxInbound = 5
          }
          if (state.network.webrtcConnectToOwnDevices === undefined) {
            state.network.webrtcConnectToOwnDevices = true
          }
          if (state.network.p2pOnlyMode === undefined) {
            state.network.p2pOnlyMode = false
          }
          // Clean up deprecated settings
          if ((state.network as any).useWorkerTransport !== undefined) {
            delete (state.network as any).useWorkerTransport
          }
          if ((state.network as any).webrtcLogLevel !== undefined) {
            delete (state.network as any).webrtcLogLevel
          }
          if (state.network.webrtcCallsEnabled === undefined) {
            state.network.webrtcCallsEnabled = true
          }
          if (state.network.webrtcFileReceivingEnabled === undefined) {
            state.network.webrtcFileReceivingEnabled = true
          }
          if (state.network.negentropyEnabled === undefined) {
            state.network.negentropyEnabled = false
          }
        }
      },
    }
  )
)
