import "@/index.css"

import {RouterProvider} from "react-router"
import {useUserStore} from "./stores/user"
import ReactDOM from "react-dom/client"
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
        const extractValue = (jsonString: string | null) => {
          if (!jsonString) return null
          try {
            const parsed = JSON.parse(jsonString)
            return parsed && typeof parsed === "object" && "value" in parsed
              ? parsed.value
              : parsed
          } catch (e) {
            console.error("Error parsing localStorage value:", e)
            return null
          }
        }

        const newState = {
          ...currentState,
          publicKey: extractValue(publicKey),
          privateKey: extractValue(privateKey) || "",
          nip07Login: extractValue(nip07Login) || false,
        }

        if (relays) {
          newState.relays = extractValue(relays) || []
        }

        if (mediaserver) {
          newState.mediaserver = extractValue(mediaserver) || ""
        }

        useUserStore.setState(newState)
        console.log("Migrated user data from localStorage to zustand")

        localStorage.removeItem("localState/user/publicKey")
        localStorage.removeItem("localState/user/privateKey")
        localStorage.removeItem("localState/user/nip07Login")
        localStorage.removeItem("localState/user/relays")
        localStorage.removeItem("localState/user/mediaserver")
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

ReactDOM.createRoot(document.getElementById("root")!).render(<AppWithInitialization />)

// Subscribe to theme changes
useSettingsStore.subscribe((state) => {
  if (typeof state.appearance.theme === "string") {
    document.documentElement.setAttribute("data-theme", state.appearance.theme)
  }
})
