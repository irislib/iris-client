import "@/index.css"

import {RouterProvider} from "react-router"
import ReactDOM from "react-dom/client"
import {useUserStore} from "./stores/user"

import {subscribeToDMNotifications, subscribeToNotifications} from "./utils/notifications"
import {loadSessions} from "@/utils/chat/Sessions"
import {useSettingsStore} from "@/stores/settings"
import {loadInvites} from "@/utils/chat/Invites"
import {ndk} from "./utils/ndk"
import {router} from "@/pages"

ndk() // init NDK & irisdb login flow

// Subscribe to public key changes from the user store
useUserStore.subscribe((state, prevState) => {
  if (state.publicKey && state.publicKey !== prevState.publicKey) {
    loadSessions()
    loadInvites()
    subscribeToNotifications()
    subscribeToDMNotifications()
  }
})

document.title = CONFIG.appName

// Initialize theme from settings store
const {appearance} = useSettingsStore.getState()
document.documentElement.setAttribute("data-theme", appearance.theme)

ReactDOM.createRoot(document.getElementById("root")!).render(
  <RouterProvider router={router} />
)

// Subscribe to theme changes
useSettingsStore.subscribe((state) => {
  if (typeof state.appearance.theme === "string") {
    document.documentElement.setAttribute("data-theme", state.appearance.theme)
  }
})
