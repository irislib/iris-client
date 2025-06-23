import "@/index.css"

import {RouterProvider} from "react-router"
import {useUserStore} from "./stores/user"
import ReactDOM from "react-dom/client"

import {subscribeToDMNotifications, subscribeToNotifications} from "./utils/notifications"
import {migrateUserState} from "./utils/migration"
import {useSettingsStore} from "@/stores/settings"
import {ndk} from "./utils/ndk"
import {router} from "@/pages"

ndk()

// Initialize chat modules if we have a public key
const state = useUserStore.getState()
if (state.publicKey) {
  console.log("Initializing chat modules with existing user data")
  subscribeToNotifications()
  subscribeToDMNotifications()
}

document.title = CONFIG.appName

// Initialize theme from settings store
const {appearance} = useSettingsStore.getState()
document.documentElement.setAttribute("data-theme", appearance.theme)

// Perform migration before rendering the app
migrateUserState()

ReactDOM.createRoot(document.getElementById("root")!).render(
  <RouterProvider router={router} />
)

// Subscribe to public key changes from the user store
useUserStore.subscribe((state) => {
  const prevPublicKey = localStorage.getItem("localState/user/publicKey")
  let parsedPrevKey = ""
  if (prevPublicKey) {
    try {
      const parsed = JSON.parse(prevPublicKey)
      parsedPrevKey =
        parsed && typeof parsed === "object" && "value" in parsed ? parsed.value : parsed
    } catch (e) {
      console.error("Error parsing prevPublicKey:", e)
    }
  }

  if (state.publicKey && state.publicKey !== parsedPrevKey) {
    console.log("Public key changed, initializing chat modules")
    subscribeToNotifications()
    subscribeToDMNotifications()
  }
})

// Subscribe to theme changes
useSettingsStore.subscribe((state) => {
  if (typeof state.appearance.theme === "string") {
    document.documentElement.setAttribute("data-theme", state.appearance.theme)
  }
})
