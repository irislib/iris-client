import {useUserStore} from "@/stores/user"
import {useState, MouseEvent} from "react"
import {useNavigate} from "@/navigation"
import localforage from "localforage"
import {nostr} from "@/utils/nostrClient"
import {AppEvent} from "@/lib/nostr"
import {SettingsGroup} from "@/shared/components/settings/SettingsGroup"
import {SettingsGroupItem} from "@/shared/components/settings/SettingsGroupItem"
import {SettingsButton} from "@/shared/components/settings/SettingsButton"
import {confirm} from "@/utils/utils"
import {KIND_CONTACTS, DEBUG_NAMESPACES} from "@/utils/constants"
import {unsubscribeAll} from "@/utils/notifications"
import {usePrivateMessagesStore} from "@/stores/privateMessages"
import {useDraftStore} from "@/stores/draft"
import {revokeCurrentDevice} from "@/shared/services/PrivateChats"
import {createDebugLogger} from "@/utils/createDebugLogger"

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

function DeleteAccount() {
  const store = useUserStore()
  const [isDeletingAccount, setIsDeletingAccount] = useState(false)
  const navigate = useNavigate()

  async function cleanupNDK() {
    const ndkInstance = nostr()
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

  async function cleanupStores() {
    try {
      await usePrivateMessagesStore.getState().clear()
      useDraftStore.getState().clearAll()
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
      try {
        log("[Logout] Unsubscribing from notifications")
        await withTimeout(unsubscribeAll(), 3000)
      } catch (e) {
        error("Error unsubscribing from push notifications:", e)
      }

      try {
        await withTimeout(cleanupStores(), 3000)
      } catch (e) {
        error("Error cleaning up stores:", e)
      }

      try {
        await revokeCurrentDevice()
      } catch (e) {
        error("Error revoking current device:", e)
      }

      log("[Logout] Cleaning up NostrClient")
      await withTimeout(cleanupNDK(), 3000)
      log("[Logout] Resetting user store")
      const {reset} = useUserStore.getState()
      reset()
    } catch (e) {
      error("Error during logout cleanup:", e)
    } finally {
      try {
        log("[Logout] Final cleanup")
        await withTimeout(Promise.all([cleanupStorage(), cleanupServiceWorker()]), 5000)
      } catch (e) {
        error("Error during final cleanup:", e)
      } finally {
        log("[Logout] Reloading app")
        navigate("/")
        location.reload()
      }
    }
  }

  async function handleDeleteAccount(e?: MouseEvent) {
    e?.preventDefault()
    e?.stopPropagation()
    log("[DeleteAccount] Starting delete account process")

    const confirmed = await confirm(
      "This will mark your account as deleted on Nostr and log you out. This action cannot be undone.",
      "Delete account?"
    )

    if (confirmed) {
      log("[DeleteAccount] User confirmed")
      setIsDeletingAccount(true)

      try {
        // Publish deleted profile
        const user = nostr().getUser({pubkey: store.publicKey})
        if (user) {
          user.profile = {name: "Account deleted", deleted: "true" as string}
          await user.publish()
          log("[DeleteAccount] Published deleted profile")
        }

        // Publish empty follow list
        const emptyFollowList = new AppEvent(nostr(), {
          kind: KIND_CONTACTS,
          pubkey: store.publicKey,
          content: "",
          created_at: Math.floor(Date.now() / 1000),
          tags: [],
        })
        await emptyFollowList.publish()
        log("[DeleteAccount] Published empty follow list")

        // Wait a moment for events to propagate
        await new Promise((resolve) => setTimeout(resolve, 1000))

        // Now perform logout
        await performLogout()
      } catch (e) {
        error("Error during account deletion:", e)
        // Still perform logout even if profile update fails
        await performLogout()
      } finally {
        setIsDeletingAccount(false)
      }
    } else {
      log("[DeleteAccount] User cancelled")
    }
  }

  return (
    <div className="bg-base-200 min-h-full">
      <div className="p-4">
        <div className="space-y-6">
          <SettingsGroup title="Delete account">
            <SettingsGroupItem>
              <div className="flex flex-col gap-3">
                <div className="text-sm text-base-content/70">
                  This will publish a deleted profile marker and empty follow list on
                  Nostr, then log you out.
                </div>
                <div className="text-sm text-base-content/70">
                  Your <span className="font-medium">Iris chats</span> and{" "}
                  <span className="font-medium">Cashu wallet</span> on this device will be
                  permanently deleted.
                </div>
                <div className="text-sm text-error font-medium">
                  This action cannot be undone.
                </div>
              </div>
            </SettingsGroupItem>

            <SettingsButton
              label={isDeletingAccount ? "Deleting..." : "Delete account"}
              onClick={handleDeleteAccount}
              variant="destructive"
              isLast
              disabled={isDeletingAccount}
            />
          </SettingsGroup>
        </div>
      </div>
    </div>
  )
}

export default DeleteAccount
