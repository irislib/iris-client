import "@/index.css"

import {RouterProvider} from "react-router"
import ReactDOM from "react-dom/client"
import {useUserStore} from "./stores/user"
import {useEffect} from "react"

import {subscribeToDMNotifications, subscribeToNotifications} from "./utils/notifications"
import {loadSessions} from "@/utils/chat/Sessions"
import {useSettingsStore} from "@/stores/settings"
import {loadInvites} from "@/utils/chat/Invites"
import {ndk} from "./utils/ndk"
import {router} from "@/pages"

ndk() // init NDK & irisdb login flow

// Initialize user store at app startup
const InitializeStore = () => {
  useEffect(() => {
    const currentState = useUserStore.getState()
    
    const publicKey = localStorage.getItem("localState/user/publicKey")
    const privateKey = localStorage.getItem("localState/user/privateKey")
    const nip07Login = localStorage.getItem("localState/user/nip07Login")
    const relays = localStorage.getItem("localState/user/relays")
    const mediaserver = localStorage.getItem("localState/user/mediaserver")
    
    if (publicKey && !currentState.publicKey) {
      try {
        const newState = {
          ...currentState,
          publicKey: JSON.parse(publicKey),
          privateKey: privateKey ? JSON.parse(privateKey) : "",
          nip07Login: nip07Login ? JSON.parse(nip07Login) : false,
        }
        
        if (relays) {
          newState.relays = JSON.parse(relays)
        }
        
        if (mediaserver) {
          newState.mediaserver = JSON.parse(mediaserver)
        }
        
        useUserStore.setState(newState)
        console.log("Migrated user data from localStorage to zustand")
      } catch (error) {
        console.error("Error migrating user data:", error)
      }
    }
    
    // Initialize chat modules if we have a public key
    const state = useUserStore.getState()
    if (state.publicKey) {
      console.log("Initializing chat modules with existing user data")
      loadSessions()
      loadInvites()
      subscribeToNotifications()
      subscribeToDMNotifications()
    }
    
    console.log("User store initialized:", useUserStore.getState())
  }, [])
  return null
}

const AppWithInitialization = () => {
  return (
    <>
      <InitializeStore />
      <RouterProvider router={router} />
    </>
  )
}

// Subscribe to public key changes from the user store
useUserStore.subscribe((state) => {
  const prevPublicKey = localStorage.getItem("localState/user/publicKey")
  const parsedPrevKey = prevPublicKey ? JSON.parse(prevPublicKey) : ""
  
  if (state.publicKey && state.publicKey !== parsedPrevKey) {
    console.log("Public key changed, initializing chat modules")
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
  <AppWithInitialization />
)

// Subscribe to theme changes
useSettingsStore.subscribe((state) => {
  if (typeof state.appearance.theme === "string") {
    document.documentElement.setAttribute("data-theme", state.appearance.theme)
  }
})
