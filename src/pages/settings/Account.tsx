import {unsubscribeAll} from "@/utils/notifications"
import {useUserStore} from "@/stores/user"
import {useUserRecordsStore} from "@/stores/userRecords"
import {useEventsStore} from "@/stores/events"
import {useDraftStore} from "@/stores/draft"
import {MouseEvent, useState} from "react"
import {useNavigate, Link} from "react-router"
import localforage from "localforage"
import {ndk} from "@/utils/ndk"
import {NDKEvent} from "@nostr-dev-kit/ndk"

// Helper function to add timeout to any promise
const withTimeout = (promise: Promise<unknown>, ms: number): Promise<unknown> => {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Operation timeout after ${ms}ms`)), ms)
    ),
  ])
}

function Account() {
  const store = useUserStore()
  const [isLoggingOut, setIsLoggingOut] = useState(false)
  const navigate = useNavigate()

  async function cleanupNDK() {
    const ndkInstance = ndk()
    ndkInstance.signer = undefined
    ndkInstance.activeUser = undefined
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
      console.error("Error clearing storage:", err)
    }
  }

  async function cleanupStores() {
    try {
      // Clear events store (clears message repository)
      await useEventsStore.getState().clear()

      // Reset stores with reset methods
      useUserRecordsStore.getState().reset()
      useDraftStore.getState().reset()

      // For stores without reset methods, we'll rely on storage clearing
      console.log("All stores cleaned up")
    } catch (err) {
      console.error("Error cleaning up stores:", err)
    }
  }

  async function publishInviteTombstones() {
    try {
      const invites = useUserRecordsStore.getState().getOwnDeviceInvites()
      for (const invite of invites.values()) {
        const deletionEvent = new NDKEvent(ndk(), {
          kind: 30078,
          pubkey: invite.inviter,
          content: "",
          created_at: Math.floor(Date.now() / 1000),
          tags: [["d", "double-ratchet/invites/" + invite.deviceId]],
        })
        try {
          await deletionEvent.publish()
        } catch (e) {
          console.warn("Error publishing invite tombstone", e)
        }
      }
    } catch (e) {
      console.error("Failed to publish invite tombstones", e)
    }
  }

  async function cleanupServiceWorker() {
    if (!("serviceWorker" in navigator)) return

    try {
      const reg = await navigator.serviceWorker.ready
      const existingSub = await reg.pushManager.getSubscription()
      if (existingSub) {
        await existingSub.unsubscribe()
        console.log("Unsubscribed from push notifications")
      }
    } catch (e) {
      console.error("Error unsubscribing from service worker:", e)
    }
  }

  async function handleLogout(e: MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    if (
      !store.privateKey ||
      confirm("Log out? Make sure you have a backup of your secret key.")
    ) {
      setIsLoggingOut(true)

      try {
        // Try to unsubscribe from notifications first, while we still have the signer
        try {
          await withTimeout(unsubscribeAll(), 3000)
        } catch (e) {
          console.error("Error unsubscribing from push notifications:", e)
        }

        // Clean up stores first (while we still have access to data)
        try {
          await withTimeout(cleanupStores(), 3000)
        } catch (e) {
          console.error("Error cleaning up stores:", e)
        }

        try {
          await publishInviteTombstones()
        } catch {}

        await withTimeout(cleanupNDK(), 3000)
        const {reset} = useUserStore.getState()
        reset()
      } catch (e) {
        console.error("Error during logout cleanup:", e)
      } finally {
        try {
          await withTimeout(Promise.all([cleanupStorage(), cleanupServiceWorker()]), 5000)
        } catch (e) {
          console.error("Error during final cleanup:", e)
        } finally {
          // Ensure spinner always stops and navigation happens
          setIsLoggingOut(false)
          navigate("/")
          location.reload()
        }
      }
    }
  }

  return (
    <div>
      <h1 className="text-2xl mb-4">Log out</h1>
      <div className="flex flex-col gap-4">
        <small>Make sure you have a backup of your secret key before logging out.</small>
        <small>
          Your <b>Iris chats</b> and <b>Cashu wallet</b> on this device will be
          permanently deleted.
        </small>
        <div className="mt-2 flex gap-2">
          {store.privateKey && (
            <Link to="/settings/backup" className="btn btn-default">
              Backup
            </Link>
          )}
          <button
            className="btn btn-primary"
            onClick={handleLogout}
            disabled={isLoggingOut}
          >
            {isLoggingOut ? (
              <div className="loading loading-spinner loading-sm" />
            ) : (
              "Log out"
            )}
          </button>
        </div>
      </div>
    </div>
  )
}

export default Account
