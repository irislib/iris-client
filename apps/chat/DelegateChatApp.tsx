import {useState, useEffect, useRef} from "react"

import {ChatNavigationProvider} from "@/chat/ChatNavigationProvider"
import {ChatRouter} from "@/chat/ChatRouter"
import ChatLayout from "@/chat/ChatLayout"
import DelegateSetup from "@/chat/DelegateSetup"

import {useDelegateDeviceStore} from "@/stores/delegateDevice"
import {useUserStore} from "@/stores/user"

import {createDebugLogger} from "@/utils/createDebugLogger"
import {DEBUG_NAMESPACES} from "@/utils/constants"
import {
  initializeDelegateDevice,
  resumeDelegateDevice,
} from "@/shared/services/DelegateDevice"

const {log, error} = createDebugLogger(DEBUG_NAMESPACES.UTILS)

type AppState = "loading" | "setup" | "activating" | "ready" | "error"

export function DelegateChatApp() {
  const [appState, setAppState] = useState<AppState>("loading")
  const [errorMessage, setErrorMessage] = useState("")
  const initializingRef = useRef(false)
  const credentials = useDelegateDeviceStore((s) => s.credentials)
  const isActivated = useDelegateDeviceStore((s) => s.isActivated)
  const ownerPublicKey = useDelegateDeviceStore((s) => s.credentials?.ownerPublicKey)

  useEffect(() => {
    if (!credentials) {
      setAppState("setup")
      return
    }

    if (isActivated && ownerPublicKey) {
      // Prevent double initialization
      if (initializingRef.current || appState === "ready") {
        return
      }
      initializingRef.current = true

      // Resume delegate device - initializes SessionManager and attaches event listeners
      log("Resuming delegate device...")
      resumeDelegateDevice(ownerPublicKey)
        .then(() => {
          log("Delegate device resumed")
          useUserStore.getState().setPublicKey(ownerPublicKey)
          setAppState("ready")
        })
        .catch((err: Error) => {
          error("Failed to resume delegate device:", err)
          setErrorMessage(err.message || "Resume failed")
          setAppState("error")
        })
        .finally(() => {
          initializingRef.current = false
        })
      return
    }

    // Have credentials but not activated - show setup so user can see/copy pairing code
    setAppState("setup")
  }, [credentials, isActivated, ownerPublicKey, appState])

  const handleActivated = () => {
    // DelegateSetup already called initializeDelegateDevice() and it succeeded
    // Just update the user store and transition to ready state
    const ownerKey = useDelegateDeviceStore.getState().credentials?.ownerPublicKey
    if (ownerKey) {
      log("Delegate device activated for owner:", ownerKey)
      useUserStore.getState().setPublicKey(ownerKey)
      setAppState("ready")
    } else {
      // Fallback: if somehow ownerPublicKey isn't set, re-initialize
      setAppState("activating")
      initializeDelegateDevice()
        .then((key) => {
          log("Delegate device activated for owner:", key)
          useUserStore.getState().setPublicKey(key)
          setAppState("ready")
        })
        .catch((err: Error) => {
          error("Failed to activate delegate device:", err)
          setErrorMessage(err.message || "Activation failed")
          setAppState("error")
        })
    }
  }

  if (appState === "loading") {
    return (
      <div className="flex items-center justify-center min-h-screen bg-base-200">
        <span className="loading loading-spinner loading-lg" />
      </div>
    )
  }

  if (appState === "setup") {
    return <DelegateSetup onActivated={handleActivated} />
  }

  if (appState === "activating") {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen p-4 bg-base-200">
        <div className="card w-full max-w-md bg-base-100 shadow-xl">
          <div className="card-body text-center">
            <span className="loading loading-spinner loading-lg mx-auto" />
            <h2 className="card-title justify-center mt-4">Connecting...</h2>
            <p className="text-base-content/70">
              Waiting for your main device to authorize this delegate.
            </p>
          </div>
        </div>
      </div>
    )
  }

  if (appState === "error") {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen p-4 bg-base-200">
        <div className="card w-full max-w-md bg-base-100 shadow-xl">
          <div className="card-body text-center">
            <h2 className="card-title justify-center text-error">Error</h2>
            <p className="text-base-content/70">{errorMessage}</p>
            <button
              className="btn btn-primary mt-4"
              onClick={() => {
                useDelegateDeviceStore.getState().clear()
                setAppState("setup")
              }}
            >
              Start Over
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ready state
  return (
    <ChatNavigationProvider>
      <ChatLayout>
        <ChatRouter />
      </ChatLayout>
    </ChatNavigationProvider>
  )
}
