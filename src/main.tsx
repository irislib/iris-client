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

const {log, error} = createDebugLogger(DEBUG_NAMESPACES.UTILS)
import {onOpenUrl} from "@tauri-apps/plugin-deep-link"
import {
  enable as enableAutostart,
  isEnabled as isAutostartEnabled,
} from "@tauri-apps/plugin-autostart"
import {
  attachSessionEventListener,
  cleanupSessionEventListener,
} from "./utils/dmEventHandler"
import {hasWriteAccess} from "./utils/auth"
import {
  initAppKeysManager,
  initDelegateManager,
  activateDevice,
  hasLocalAppKeys,
  getDelegateManager,
  startAppKeysSubscription,
} from "@/shared/services/PrivateChats"
import {useDevicesStore} from "./stores/devices"

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
    useDevicesStore.getState().setSetupStatus("initializing")
    try {
      // Initialize AppKeysManager first so we can check local keys immediately
      await initAppKeysManager()
      log("✅ AppKeysManager initialized")
      useDevicesStore.getState().setAppKeysManagerReady(true)
      useDevicesStore.getState().setHasLocalAppKeys(hasLocalAppKeys())
      useDevicesStore.getState().setSetupStatus("ready_to_register")

      // Initialize DelegateManager in the background
      initDelegateManager()
        .then(() => log("✅ DelegateManager initialized"))
        .catch((err) => error("Failed to initialize DelegateManager:", err))
    } catch (err) {
      error("Failed to initialize AppKeysManager:", err)
      useDevicesStore
        .getState()
        .setSetupError(err instanceof Error ? err.message : "Unknown error")
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
      // Initialize AppKeysManager first (fast), then DelegateManager + SessionManager
      useDevicesStore.getState().setSetupStatus("initializing")

      // Start AppKeysManager first so we can check local keys immediately
      initAppKeysManager()
        .then(() => {
          useDevicesStore.getState().setAppKeysManagerReady(true)
          useDevicesStore.getState().setHasLocalAppKeys(hasLocalAppKeys())
          useDevicesStore.getState().setSetupStatus("ready_to_register")
          startAppKeysSubscription(state.publicKey)
          log("✅ AppKeysManager initialized")
        })
        .catch((err) => {
          error("Failed to initialize AppKeysManager:", err)
          useDevicesStore
            .getState()
            .setSetupError(err instanceof Error ? err.message : "Unknown error")
        })

      // Initialize DelegateManager and activate device (can happen in parallel with AppKeysManager)
      initDelegateManager()
        .then(() => activateDevice(state.publicKey))
        .then(() => {
          useDevicesStore.getState().setSessionManagerReady(true)
          const delegateManager = getDelegateManager()
          useDevicesStore
            .getState()
            .setIdentityPubkey(delegateManager.getIdentityPublicKey())
          attachSessionEventListener()
          log("✅ Device activated and session listener attached")
        })
        .catch((err) => {
          error("Failed to activate device:", err)
          useDevicesStore
            .getState()
            .setSetupError(err instanceof Error ? err.message : "Unknown error")
        })
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
      // Initialize AppKeysManager first (fast), then DelegateManager + SessionManager
      useDevicesStore.getState().setSetupStatus("initializing")

      // Start AppKeysManager first so we can check local keys immediately
      initAppKeysManager()
        .then(() => {
          useDevicesStore.getState().setAppKeysManagerReady(true)
          useDevicesStore.getState().setHasLocalAppKeys(hasLocalAppKeys())
          useDevicesStore.getState().setSetupStatus("ready_to_register")
          startAppKeysSubscription(state.publicKey)
          log("✅ AppKeysManager initialized (login)")
        })
        .catch((err) => {
          error("Failed to initialize AppKeysManager on login:", err)
          useDevicesStore
            .getState()
            .setSetupError(err instanceof Error ? err.message : "Unknown error")
        })

      // Initialize DelegateManager and activate device (can happen in parallel with AppKeysManager)
      initDelegateManager()
        .then(() => activateDevice(state.publicKey))
        .then(() => {
          useDevicesStore.getState().setSessionManagerReady(true)
          const delegateManager = getDelegateManager()
          useDevicesStore
            .getState()
            .setIdentityPubkey(delegateManager.getIdentityPublicKey())
          attachSessionEventListener()
          log("✅ Device activated and session listener attached (login)")
        })
        .catch((err) => {
          error("Failed to activate device on login:", err)
          useDevicesStore
            .getState()
            .setSetupError(err instanceof Error ? err.message : "Unknown error")
        })
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
  })
}
