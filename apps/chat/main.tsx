import "@/index.css"

import {ChatNavigationProvider} from "@/chat/ChatNavigationProvider"
import {ChatRouter} from "@/chat/ChatRouter"
import ChatLayout from "@/chat/ChatLayout"
import {useUserStore} from "@/stores/user"
import ReactDOM from "react-dom/client"

import {subscribeToDMNotifications} from "@/utils/notifications"
import {useSettingsStore} from "@/stores/settings"
import {initializeDebugLogging, createDebugLogger} from "@/utils/createDebugLogger"
import {DEBUG_NAMESPACES} from "@/utils/constants"

const {log, error} = createDebugLogger(DEBUG_NAMESPACES.UTILS)

import {attachSessionEventListener, cleanupSessionEventListener} from "@/utils/dmEventHandler"
import {hasWriteAccess} from "@/utils/auth"

// Move initialization to a function to avoid side effects
const initializeApp = async () => {
  // Initialize debug logging first
  initializeDebugLogging()

  // Wait for settings to hydrate from localStorage before initializing NDK
  await useUserStore.getState().awaitHydration()

  // Start NDK initialization in background (non-blocking)
  import("@/utils/ndk").then(async ({initNDK}) => {
    await initNDK()
    log("NDK initialized")
  })

  // Initialize chat modules if we have a public key
  const state = useUserStore.getState()
  if (state.publicKey) {
    log("Initializing chat modules with existing user data")

    subscribeToDMNotifications()

    // Only initialize DM sessions if not in readonly mode
    if (hasWriteAccess()) {
      attachSessionEventListener()
    }
  }

  document.title = "Iris Chat"

  // Initialize theme from settings store
  const {appearance} = useSettingsStore.getState()
  document.documentElement.setAttribute(
    "data-theme",
    appearance.theme || CONFIG.defaultTheme
  )

  return true
}

// Initialize app and render when ready
const root = ReactDOM.createRoot(document.getElementById("root")!)

initializeApp()
  .then(() => {
    root.render(
      <ChatNavigationProvider>
        <ChatLayout>
          <ChatRouter />
        </ChatLayout>
      </ChatNavigationProvider>
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

    subscribeToDMNotifications()

    // Only initialize DM sessions if not in readonly mode
    if (hasWriteAccess()) {
      attachSessionEventListener()
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
