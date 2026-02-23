import {unsubscribeAll} from "@/utils/notifications"
import {useUserStore} from "@/stores/user"
// import {useUserRecordsStore} from "@/stores/userRecords" // TEMP: Removed
import {usePrivateMessagesStore} from "@/stores/privateMessages"
import {useDraftStore} from "@/stores/draft"
import {MouseEvent, useEffect, useState} from "react"
import {useNavigate} from "@/navigation"
import localforage from "localforage"
import {ndk} from "@/utils/ndk"
import {SettingsGroup} from "@/shared/components/settings/SettingsGroup"
import {SettingsGroupItem} from "@/shared/components/settings/SettingsGroupItem"
import {useWalletProviderStore} from "@/stores/walletProvider"
import {SettingsButton} from "@/shared/components/settings/SettingsButton"
import {confirm} from "@/utils/utils"
import {revokeCurrentDevice} from "@/shared/services/PrivateChats"
import {createDebugLogger} from "@/utils/createDebugLogger"
import {DEBUG_NAMESPACES} from "@/utils/constants"

const {log, error} = createDebugLogger(DEBUG_NAMESPACES.UTILS)

// Helper function to add timeout to any promise
const withTimeout = (promise: Promise<unknown>, ms: number): Promise<unknown> => {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Operation timeout after ${ms}ms`)), ms)
    ),
  ])
}

function Logout() {
  const store = useUserStore()
  const [isLoggingOut, setIsLoggingOut] = useState(false)
  const [cashuBalance, setCashuBalance] = useState<number | null>(null)
  const navigate = useNavigate()
  const {activeProviderType, nwcConnections, activeNWCId, getBalance} =
    useWalletProviderStore()

  useEffect(() => {
    const fetchBalance = async () => {
      if (activeProviderType === "nwc" && activeNWCId) {
        const connection = nwcConnections.find((c) => c.id === activeNWCId)
        if (connection?.isLocalCashuWallet) {
          try {
            const balance = await getBalance()
            setCashuBalance(balance ?? connection.balance ?? null)
          } catch (err) {
            error("Error getting Cashu balance:", err)
            // Fall back to stored balance if live call fails
            setCashuBalance(connection.balance ?? null)
          }
        } else {
          setCashuBalance(null)
        }
      } else {
        setCashuBalance(null)
      }
    }

    fetchBalance()
  }, [activeProviderType, activeNWCId, nwcConnections, getBalance])

  async function cleanupNDK() {
    const ndkInstance = ndk()
    ndkInstance.signer = undefined
    ndkInstance.pool.relays.forEach((relay) => {
      relay.disconnect()
    })
    ndkInstance.pool.relays.clear()
  }

  async function cleanupStorage() {
    try {
      localStorage.clear()
      await localforage.clear()
    } catch (err) {
      error("Error clearing storage:", err)
    }
  }

  async function cleanupSessionManagerStorage() {
    try {
      await localforage.dropInstance({
        name: "iris-session-manager",
        storeName: "session-private",
      })
      log("Cleared session manager storage")
    } catch (err) {
      error("Error clearing session manager storage:", err)
    }
  }

  async function cleanupStores() {
    try {
      // Clear events store (clears message repository)
      await usePrivateMessagesStore.getState().clear()

      // TEMP: Skip resetting userRecords store
      // useUserRecordsStore.getState().reset()
      useDraftStore.getState().clearAll()

      // For stores without reset methods, we'll rely on storage clearing
      log("All stores cleaned up")
    } catch (err) {
      error("Error cleaning up stores:", err)
    }
  }

  async function cleanupServiceWorker() {
    if (!("serviceWorker" in navigator)) return

    try {
      const reg = await navigator.serviceWorker.ready
      const existingSub = await reg.pushManager.getSubscription()
      if (existingSub) {
        await existingSub.unsubscribe()
        log("Unsubscribed from push notifications")
      }
    } catch (e) {
      error("Error unsubscribing from service worker:", e)
    }
  }

  async function performLogout() {
    try {
      // Revoke current device from messaging appkeys
      try {
        log("[Logout] Revoking current device from appkeys")
        await withTimeout(revokeCurrentDevice(), 5000)
      } catch (e) {
        error("Error revoking device:", e)
      }

      // Try to unsubscribe from notifications first, while we still have the signer
      try {
        log("[Logout] Unsubscribing from notifications")
        await withTimeout(unsubscribeAll(), 3000)
      } catch (e) {
        error("Error unsubscribing from push notifications:", e)
      }

      // Clean up stores first (while we still have access to data)
      try {
        await withTimeout(cleanupStores(), 3000)
      } catch (e) {
        error("Error cleaning up stores:", e)
      }

      log("[Logout] Cleaning up NDK")
      await withTimeout(cleanupNDK(), 3000)
      log("[Logout] Resetting user store")
      const {reset} = useUserStore.getState()
      reset()
    } catch (e) {
      error("Error during logout cleanup:", e)
    } finally {
      try {
        log("[Logout] Final cleanup")
        await withTimeout(
          Promise.all([
            cleanupStorage(),
            cleanupSessionManagerStorage(),
            cleanupServiceWorker(),
          ]),
          5000
        )
      } catch (e) {
        error("Error during final cleanup:", e)
      } finally {
        // Ensure spinner always stops and navigation happens
        log("[Logout] Reloading app")
        navigate("/")
        location.reload()
      }
    }
  }

  async function handleLogout(e?: MouseEvent) {
    e?.preventDefault()
    e?.stopPropagation()
    log("[Logout] Starting logout process")

    const confirmed =
      !store.privateKey ||
      (await confirm("Make sure you have a backup of your secret key.", "Log out?"))

    if (confirmed) {
      log("[Logout] User confirmed")
      setIsLoggingOut(true)
      await performLogout()
      setIsLoggingOut(false)
    } else {
      log("[Logout] User cancelled")
    }
  }

  return (
    <div className="bg-base-200 min-h-full">
      <div className="p-4">
        <div className="space-y-6">
          {store.privateKey && (
            <SettingsGroup title="Before you go">
              <SettingsGroupItem onClick={() => navigate("/settings/keys")}>
                <div className="flex items-center justify-between">
                  <span>Backup secret key</span>
                  <svg
                    className="w-5 h-5 text-base-content/40"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9 5l7 7-7 7"
                    />
                  </svg>
                </div>
              </SettingsGroupItem>
              <SettingsGroupItem onClick={() => navigate("/chats/new/devices")} isLast>
                <div className="flex items-center justify-between">
                  <span>Remove this device from messaging</span>
                  <svg
                    className="w-5 h-5 text-base-content/40"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9 5l7 7-7 7"
                    />
                  </svg>
                </div>
              </SettingsGroupItem>
            </SettingsGroup>
          )}

          <SettingsGroup title="Log out">
            <SettingsGroupItem>
              <div className="flex flex-col gap-3">
                <div className="text-sm text-base-content/70">
                  Make sure you have a backup of your secret key before logging out.
                </div>
                <div className="text-sm text-base-content/70">
                  Your <span className="font-medium">Iris chats</span> and{" "}
                  <span className="font-medium">Cashu wallet</span> on this device will be
                  permanently deleted.
                </div>
                {cashuBalance !== null && cashuBalance > 0 && (
                  <div className="text-sm text-warning font-medium">
                    Your Cashu wallet contains {cashuBalance} bits that will be lost!
                  </div>
                )}
              </div>
            </SettingsGroupItem>

            <SettingsButton
              label={isLoggingOut ? "Logging out..." : "Log out"}
              onClick={handleLogout}
              variant="destructive"
              isLast
              disabled={isLoggingOut}
            />
          </SettingsGroup>
        </div>
      </div>
    </div>
  )
}

export default Logout
