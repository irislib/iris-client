import "@/index.css"

import ReactDOM from "react-dom/client"

import {DelegateChatApp} from "./DelegateChatApp"

import {useDelegateDeviceStore} from "@/stores/delegateDevice"
import {useSettingsStore} from "@/stores/settings"

import {initializeDebugLogging, createDebugLogger} from "@/utils/createDebugLogger"
import {DEBUG_NAMESPACES} from "@/utils/constants"
import {closeDelegateDevice} from "@/shared/services/DelegateDevice"

const {error} = createDebugLogger(DEBUG_NAMESPACES.UTILS)

// Initialize app
const initializeApp = async () => {
  initializeDebugLogging()

  // Wait for stores to hydrate
  await Promise.all([
    useDelegateDeviceStore.getState().awaitHydration(),
    useSettingsStore.getState().awaitHydration?.() || Promise.resolve(),
  ])

  // Start NDK initialization
  const {initNDK} = await import("@/utils/ndk")
  await initNDK()

  document.title = "Iris Chat"

  // Initialize theme
  const {appearance} = useSettingsStore.getState()
  document.documentElement.setAttribute(
    "data-theme",
    appearance.theme || CONFIG.defaultTheme
  )
}

const root = ReactDOM.createRoot(document.getElementById("root")!)

initializeApp()
  .then(() => {
    root.render(<DelegateChatApp />)
  })
  .catch((err: Error) => {
    error("[Init] Initialization failed:", err)
    root.render(
      <div className="flex items-center justify-center min-h-screen bg-base-200 text-error">
        Failed to initialize: {err.message}
      </div>
    )
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
    unsubscribeTheme()
    closeDelegateDevice()
  })
}
