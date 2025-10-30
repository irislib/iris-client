import {NDKEvent} from "@nostr-dev-kit/ndk"
import {useUserStore} from "@/stores/user"
import {useNotificationsStore} from "@/stores/notifications"
import {useSettingsStore} from "@/stores/settings"
import {isTauri} from "./utils"
import {
  KIND_TEXT_NOTE,
  KIND_REPOST,
  KIND_REACTION,
  KIND_ZAP_RECEIPT,
} from "@/utils/constants"
import {sendNotification} from "@tauri-apps/plugin-notification"
import {setDesktopNotificationCallback} from "@/shared/components/feed/notificationsSubscription"

/**
 * Initialize desktop notifications by subscribing to NDK for relevant events
 * Only runs on desktop Tauri app
 */
export async function initDesktopNotifications() {
  console.log("[Desktop Notifications] initDesktopNotifications called")
  if (!isTauri()) {
    console.log("[Desktop Notifications] Not running in Tauri, skipping")
    return
  }

  const myPubKey = useUserStore.getState().publicKey
  if (!myPubKey) {
    console.log("[Desktop Notifications] No user public key, skipping")
    return
  }

  // Check platform - only run on desktop (not mobile)
  try {
    const {isMobileTauri} = await import("./utils")
    const isMobile = await isMobileTauri()
    if (isMobile) {
      console.log("[Desktop Notifications] Running on mobile, skipping")
      return
    }
  } catch (e) {
    console.error("[Desktop Notifications] Failed to check platform:", e)
    return
  }

  console.log("Initializing desktop notifications via NDK")

  // Build notification filter based on user preferences
  const prefs = useSettingsStore.getState().notifications.preferences || {
    mentions: true,
    replies: true,
    reposts: true,
    reactions: true,
    zaps: true,
    dms: true,
  }
  console.log("[Desktop Notifications] Preferences:", prefs)

  const kinds: number[] = []

  if (prefs.mentions || prefs.replies) {
    kinds.push(KIND_TEXT_NOTE)
  }
  if (prefs.reposts) {
    kinds.push(KIND_REPOST)
  }
  if (prefs.reactions) {
    kinds.push(KIND_REACTION)
  }
  if (prefs.zaps) {
    kinds.push(KIND_ZAP_RECEIPT)
  }

  console.log(
    "[Desktop Notifications] Setting up callback to reuse existing notifications subscription"
  )

  // Register callback to be called by the existing notifications subscription
  setDesktopNotificationCallback((event: NDKEvent) => {
    handleNotificationEvent(event)
  })

  console.log("[Desktop Notifications] Callback registered")
}

/**
 * Handle incoming notification event from NDK
 */
async function handleNotificationEvent(event: NDKEvent) {
  const myPubKey = useUserStore.getState().publicKey
  if (!myPubKey || event.pubkey === myPubKey) {
    console.log("[Desktop Notifications] Skipping own event")
    return // Don't notify on own events
  }

  // Check if we've already seen this notification
  const lastNotification = useNotificationsStore.getState().latestNotification
  if (event.created_at && event.created_at * 1000 <= lastNotification) {
    console.log("[Desktop Notifications] Already seen, skipping")
    return // Already seen
  }

  // Update latest notification timestamp
  if (event.created_at) {
    useNotificationsStore.getState().setLatestNotification(event.created_at * 1000)
  }

  // Check user preferences
  const prefs = useSettingsStore.getState().notifications.preferences || {
    mentions: true,
    replies: true,
    reposts: true,
    reactions: true,
    zaps: true,
    dms: true,
  }

  // Get author info
  const author = event.author
  await author.fetchProfile()
  const authorName = author.profile?.displayName || author.profile?.name || "Someone"

  let title = ""
  let body = ""

  switch (event.kind) {
    case KIND_TEXT_NOTE: {
      // Check if it's a reply or mention
      const mentionedPubkeys = event.getMatchingTags("p").map((tag) => tag[1])
      const isReply = event.getMatchingTags("e").length > 0

      if (isReply) {
        if (!prefs.replies) {
          console.log("[Desktop Notifications] Reply notification disabled, skipping")
          return
        }
        title = `${authorName} replied to you`
      } else if (mentionedPubkeys.includes(myPubKey)) {
        if (!prefs.mentions) {
          console.log("[Desktop Notifications] Mention notification disabled, skipping")
          return
        }
        title = `${authorName} mentioned you`
      } else {
        if (!prefs.mentions) {
          console.log("[Desktop Notifications] Mention notification disabled, skipping")
          return
        }
        title = `New post from ${authorName}`
      }
      body = event.content.slice(0, 100)
      break
    }
    case KIND_REPOST:
      if (!prefs.reposts) {
        console.log("[Desktop Notifications] Repost notification disabled, skipping")
        return
      }
      title = `${authorName} reposted you`
      body = event.content || "Your post was reposted"
      break
    case KIND_REACTION:
      if (!prefs.reactions) {
        console.log("[Desktop Notifications] Reaction notification disabled, skipping")
        return
      }
      title = `${authorName} reacted to your post`
      body = event.content || "❤️"
      break
    case KIND_ZAP_RECEIPT: {
      if (!prefs.zaps) {
        console.log("[Desktop Notifications] Zap notification disabled, skipping")
        return
      }
      // Extract zap amount if available
      const description = event.getMatchingTags("description")[0]?.[1]
      let zapAmount = ""
      if (description) {
        try {
          const zapRequest = JSON.parse(description)
          const amount = zapRequest.tags?.find((t: string[]) => t[0] === "amount")?.[1]
          if (amount) {
            zapAmount = ` (${Math.floor(parseInt(amount) / 1000)} sats)`
          }
        } catch (e) {
          // Ignore parse errors
        }
      }
      title = `${authorName} zapped you${zapAmount}`
      body = "You received a zap!"
      break
    }
  }

  // Show notification
  console.log("[Desktop Notifications] Showing notification:", {title, body})
  try {
    await sendNotification({
      title,
      body,
    })
    console.log("[Desktop Notifications] Notification sent successfully")
  } catch (error) {
    console.error("[Desktop Notifications] Failed to send notification:", error)
  }
}

/**
 * Handle DM event for desktop notifications
 * Called from SessionManager onEvent callback with decrypted Rumor
 */
export async function handleDMEvent(
  event: {pubkey: string; kind: number; content: string},
  fromPubKey: string
) {
  const prefs = useSettingsStore.getState().notifications.preferences || {
    mentions: true,
    replies: true,
    reposts: true,
    reactions: true,
    zaps: true,
    dms: true,
  }

  if (!prefs.dms) {
    console.log("[Desktop DM Notification] DM notifications disabled")
    return
  }

  // Get the NDK user for profile info
  const {NDKUser} = await import("@nostr-dev-kit/ndk")
  const {ndk} = await import("./ndk")
  const author = new NDKUser({pubkey: fromPubKey})
  author.ndk = ndk()
  await author.fetchProfile()

  const authorName = author.profile?.displayName || author.profile?.name || "Someone"
  const messagePreview = event.content ? event.content.slice(0, 100) : "New message"

  console.log("[Desktop DM Notification] Showing notification for DM from:", authorName)

  try {
    const {sendNotification} = await import("@tauri-apps/plugin-notification")
    await sendNotification({
      title: `${authorName}`,
      body: messagePreview,
    })
    console.log("[Desktop DM Notification] Sent successfully")
  } catch (error) {
    console.error("[Desktop DM Notification] Failed to send:", error)
  }
}

/**
 * Stop desktop notification subscriptions
 */
export function stopDesktopNotifications() {
  setDesktopNotificationCallback(null)
  console.log("[Desktop Notifications] Stopped")
}
