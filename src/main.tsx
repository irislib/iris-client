import "@/index.css"

import {RouterProvider} from "react-router"
import {useUserStore} from "./stores/user"
import ReactDOM from "react-dom/client"

import {subscribeToDMNotifications, subscribeToNotifications} from "./utils/notifications"
import {migrateUserState, migratePublicChats} from "./utils/migration"
import {useSettingsStore} from "@/stores/settings"
import {useSessionsStore} from "@/stores/sessions"
import {initApplesauce} from "./utils/applesauce"
import {router} from "@/pages"
import socialGraph from "./utils/socialGraph"
import DebugManager from "./utils/DebugManager"

initApplesauce()

// Initialize debug system
DebugManager

// Initialize chat modules if we have a public key
const state = useUserStore.getState()
if (state.publicKey) {
  console.log("Initializing chat modules with existing user data")
  subscribeToNotifications()
  subscribeToDMNotifications()
  migratePublicChats()
  socialGraph().recalculateFollowDistances()
  useSessionsStore.getState().createDefaultInvites()
}

document.title = "Iris"

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
    migratePublicChats()
    useSessionsStore.getState().createDefaultInvites()
  }
})

// Subscribe to theme changes
useSettingsStore.subscribe((state) => {
  if (typeof state.appearance.theme === "string") {
    document.documentElement.setAttribute("data-theme", state.appearance.theme)
  }
})
