import "@/index.css"

import {NavigationProvider, Router} from "@/navigation"
import {useUserStore} from "./stores/user"
import ReactDOM from "react-dom/client"

import {subscribeToDMNotifications, subscribeToNotifications} from "./utils/notifications"
import {migrateUserState, migratePublicChats} from "./utils/migration"
import {useSettingsStore} from "@/stores/settings"
import DebugManager from "./utils/DebugManager"
import Layout from "@/shared/components/Layout"
import {initializeDebugLogging, createDebugLogger} from "./utils/createDebugLogger"
import {DEBUG_NAMESPACES} from "@/utils/constants"
import {initServiceWorkerAutoReload} from "@/swInit"
import {startMessageExpirationCleanup} from "@/utils/messageExpirationCleanup"
import {syncDisappearingMessagesToSessionManager} from "@/utils/disappearingMessages"

const {log, error} = createDebugLogger(DEBUG_NAMESPACES.UTILS)
import {cleanupSessionEventListener} from "./utils/dmEventHandler"
import {cleanupGroupMessageListener} from "./utils/groupMessageHandler"
import {hasWriteAccess, shouldStartPrivateMessagingOnAuthChange} from "./utils/auth"
import {maybeAutoEnableInjectedNip07Login} from "./utils/injectedNip07"
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
import {syncInjectedHtreeHeadAssetUrls} from "./utils/nativeHtree"

// Auto-update and auto-reload the PWA when a new service worker version is available.
initServiceWorkerAutoReload()
startMessageExpirationCleanup()

const startPrivateMessaging = (ownerPubkey: string) => {
  initAppKeysManager()
    .then(() => {
      useDevicesStore.getState().setAppKeysManagerReady(true)
      useDevicesStore.getState().setHasLocalAppKeys(hasLocalAppKeys())
    })
    .catch((err) => error("Failed to initialize AppKeysManager:", err))

  initPrivateMessaging(ownerPubkey)
    .then(() => {
      startAppKeysSubscription(ownerPubkey)
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
  void maybeAutoEnableInjectedNip07Login()

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

  // Initialize chat modules if we have a public key
  const state = useUserStore.getState()
  if (state.publicKey) {
    log("Initializing chat modules with existing user data")

    subscribeToNotifications()
    subscribeToDMNotifications()
    void migratePublicChats()
    // Recalculate follow distances after social graph loads
    import("@/utils/socialGraph").then(({socialGraphLoaded, getSocialGraph}) => {
      socialGraphLoaded.then(() => getSocialGraph().recalculateFollowDistances())
    })

    // Only initialize DM sessions if not in readonly mode
    if (hasWriteAccess()) {
      startPrivateMessaging(state.publicKey)
    }
  }

  document.title = CONFIG.appName
  syncInjectedHtreeHeadAssetUrls()

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

    subscribeToNotifications()
    subscribeToDMNotifications()
    void migratePublicChats()

    // Only initialize DM sessions if not in readonly mode
    if (hasWriteAccess()) {
      startPrivateMessaging(state.publicKey)
    }
    return
  }

  if (shouldStartPrivateMessagingOnAuthChange(state, prevState)) {
    log("Write access enabled, initializing private messaging")
    startPrivateMessaging(state.publicKey!)
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
