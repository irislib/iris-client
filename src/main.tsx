import "@/index.css"

import {NavigationProvider, Router} from "@/navigation"
import {useUserStore} from "./stores/user"
import ReactDOM from "react-dom/client"

import {subscribeToDMNotifications, subscribeToNotifications} from "./utils/notifications"
import {migrateUserState, migratePublicChats} from "./utils/migration"
import pushNotifications from "./utils/pushNotifications"
import {useSettingsStore} from "@/stores/settings"
import {ndk} from "./utils/ndk"
import DebugManager from "./utils/DebugManager"
import Layout from "@/shared/components/Layout"
import {isTauri, isMobileTauri} from "./utils/utils"
import {initializeDebugLogging, createDebugLogger} from "./utils/createDebugLogger"
import {DEBUG_NAMESPACES} from "@/utils/constants"
import {initServiceWorkerAutoReload} from "@/swInit"
import {startMessageExpirationCleanup} from "@/utils/messageExpirationCleanup"
import {syncDisappearingMessagesToSessionManager} from "@/utils/disappearingMessages"

const {log, error} = createDebugLogger(DEBUG_NAMESPACES.UTILS)
import {onOpenUrl} from "@tauri-apps/plugin-deep-link"
import {
  enable as enableAutostart,
  isEnabled as isAutostartEnabled,
} from "@tauri-apps/plugin-autostart"
import {cleanupSessionEventListener} from "./utils/dmEventHandler"
import {cleanupGroupMessageListener} from "./utils/groupMessageHandler"
import {hasWriteAccess} from "./utils/auth"
import {
  initAppKeysManager,
  initDelegateManager,
  initPrivateMessaging,
  hasLocalAppKeys,
  getDelegateManager,
  startAppKeysSubscription,
} from "@/shared/services/PrivateChats"
import {useDevicesStore} from "./stores/devices"
import {autoRegisterDevice} from "./utils/autoRegisterDevice"

// Auto-update and auto-reload the PWA when a new service worker version is available.
initServiceWorkerAutoReload()
startMessageExpirationCleanup()

// Register deep link handler for hot starts (when app already open)
// Note: Cold start (app closed) doesn't work due to Tauri bug #13580
if (isTauri()) {
  onOpenUrl((urls) => {
    if (!urls?.length) return

    const url = urls[0]
    let path: string
    let state: Record<string, unknown> | undefined

    if (url.startsWith("lightning:")) {
      const invoice = url.replace(/^lightning:/, "")
      path = "/wallet"
      state = {lightningInvoice: invoice}
    } else {
      path = `/${url.replace(/^(nostr:|web\+nostr:)/, "")}`
      state = undefined
    }

    // Dispatch custom event for NavigationProvider to handle
    window.dispatchEvent(new CustomEvent("iris-deep-link", {detail: {path, state}}))
  })
}

// Check if logged-in user has deleted account (Tauri only)
const checkDeletedAccount = async (publicKey: string) => {
  if (!isTauri()) {
    return
  }

  try {
    const user = ndk().getUser({pubkey: publicKey})
    await user.fetchProfile()
    if (user.profile?.deleted) {
      log("Detected deleted account, logging out")
      // Clear user state
      useUserStore.getState().reset()
      // Clear storage
      localStorage.clear()
      // Reload
      location.reload()
    }
  } catch (e) {
    error("Error checking deleted account:", e)
  }
}

const startPrivateMessaging = (ownerPubkey: string) => {
  initAppKeysManager()
    .then(() => {
      useDevicesStore.getState().setAppKeysManagerReady(true)
      useDevicesStore.getState().setHasLocalAppKeys(hasLocalAppKeys())
      startAppKeysSubscription(ownerPubkey)
    })
    .catch((err) => error("Failed to initialize AppKeysManager:", err))

  initPrivateMessaging(ownerPubkey)
    .then(() => {
      useDevicesStore.getState().setSessionManagerReady(true)
      const dm = getDelegateManager()
      useDevicesStore.getState().setIdentityPubkey(dm.getIdentityPublicKey())
      syncDisappearingMessagesToSessionManager().catch(error)
      subscribeToDMNotifications()
      void autoRegisterDevice()
      log("Device activated and session listener attached")
    })
    .catch((err) => error("Failed to activate device:", err))
}

// Move initialization to a function to avoid side effects
const initializeApp = async () => {
  // Initialize debug logging first
  initializeDebugLogging()

  // Wait for settings to hydrate from localStorage before initializing NDK
  await useUserStore.getState().awaitHydration()

  // Start NDK initialization in background (non-blocking)
  import("@/utils/ndk").then(async ({initNDK}) => {
    await initNDK()
    log("✅ NDK initialized")

    // Initialize AppKeysManager first (fast), then DelegateManager in parallel
    try {
      // Initialize AppKeysManager first so we can check local keys immediately
      await initAppKeysManager()
      log("✅ AppKeysManager initialized")
      useDevicesStore.getState().setAppKeysManagerReady(true)
      useDevicesStore.getState().setHasLocalAppKeys(hasLocalAppKeys())

      // Initialize DelegateManager in the background
      initDelegateManager()
        .then(() => log("✅ DelegateManager initialized"))
        .catch((err) => error("Failed to initialize DelegateManager:", err))
    } catch (err) {
      error("Failed to initialize AppKeysManager:", err)
    }
  })

  // Load social graph in background (non-blocking)
  import("@/utils/socialGraph").then(
    async ({socialGraphLoaded, setupSocialGraphSubscriptions}) => {
      await socialGraphLoaded
      log("✅ Social graph initialized")
      await setupSocialGraphSubscriptions()
      log("✅ Social graph subscriptions ready")
    }
  )

  // Initialize debug system
  DebugManager

  // Enable autostart on first launch if not already set (desktop only)
  if (isTauri()) {
    try {
      const {desktop} = useSettingsStore.getState()
      const autostartCurrentlyEnabled = await isAutostartEnabled()

      // If setting is true but autostart is disabled, enable it
      if (desktop.startOnBoot && !autostartCurrentlyEnabled) {
        await enableAutostart()
      }
    } catch (err) {
      error("Failed to initialize autostart:", err)
    }
  }

  // Initialize chat modules if we have a public key
  const state = useUserStore.getState()
  if (state.publicKey) {
    log("Initializing chat modules with existing user data")

    // Check for deleted account first
    void checkDeletedAccount(state.publicKey)

    subscribeToNotifications()
    subscribeToDMNotifications()
    void migratePublicChats()
    // Recalculate follow distances after social graph loads
    import("@/utils/socialGraph").then(({socialGraphLoaded, getSocialGraph}) => {
      socialGraphLoaded.then(() => getSocialGraph().recalculateFollowDistances())
    })

    // Initialize platform-specific notifications (non-blocking, parallel to web push)
    log("[Init] isTauri():", isTauri())
    if (isTauri()) {
      ;(async () => {
        const isMobile = await isMobileTauri()
        log("[Init] isMobileTauri:", isMobile)
        if (isMobile) {
          log("[Init] Initializing mobile push notifications")
          pushNotifications.init().catch(error)
        } else {
          log("[Init] Initializing desktop notifications")
          const {initDesktopNotifications} = await import("./utils/desktopNotifications")
          initDesktopNotifications().catch(error)
        }
      })().catch(error)
    }

    // Only initialize DM sessions if not in readonly mode
    if (hasWriteAccess()) {
      startPrivateMessaging(state.publicKey)
    }
  }

  document.title = CONFIG.appName

  // Initialize theme from settings store
  const {appearance} = useSettingsStore.getState()
  document.documentElement.setAttribute(
    "data-theme",
    appearance.theme || CONFIG.defaultTheme
  )

  // Perform migration before rendering the app
  migrateUserState()

  // Return true when complete
  return true
}

// Initialize app and render when ready
const root = ReactDOM.createRoot(document.getElementById("root")!)

initializeApp()
  .then(() => {
    root.render(
      <NavigationProvider>
        <Layout>
          <Router />
        </Layout>
      </NavigationProvider>
    )
  })
  .catch((err) => {
    error("[Init] Initialization failed:", err)
  })

// Store subscriptions
const unsubscribeUser = useUserStore.subscribe((state, prevState) => {
  // Only proceed if public key actually changed
  if (state.publicKey && state.publicKey !== prevState.publicKey) {
    log("Public key changed, initializing chat modules")

    // Check for deleted account when user logs in
    checkDeletedAccount(state.publicKey)

    subscribeToNotifications()
    subscribeToDMNotifications()
    void migratePublicChats()

    // Only initialize DM sessions if not in readonly mode
    if (hasWriteAccess()) {
      startPrivateMessaging(state.publicKey)
    }
  }
})

// Subscribe to theme changes
const unsubscribeTheme = useSettingsStore.subscribe((state) => {
  if (typeof state.appearance.theme === "string") {
    document.documentElement.setAttribute("data-theme", state.appearance.theme)
  }
})

// HMR support
if (import.meta.hot) {
  import.meta.hot.accept()
  import.meta.hot.dispose(() => {
    // Clean up subscriptions on hot reload
    unsubscribeUser()
    unsubscribeTheme()
    cleanupSessionEventListener()
    cleanupGroupMessageListener()
  })
}
