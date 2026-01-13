import {getSessionManager} from "@/shared/services/PrivateChats"
import {useUserStore} from "@/stores/user"
import {usePrivateMessagesStore} from "@/stores/privateMessages"
import {useGroupsStore} from "@/stores/groups"
import {getTag} from "./tagUtils"
import {KIND_CHANNEL_CREATE} from "./constants"
import {isTauri} from "./utils"
import {getSocialGraph} from "./socialGraph"
import {createDebugLogger} from "@/utils/createDebugLogger"
import {DEBUG_NAMESPACES} from "@/utils/constants"

const {log, error} = createDebugLogger(DEBUG_NAMESPACES.UTILS)

let unsubscribeSessionEvents: (() => void) | null = null

export const cleanupSessionEventListener = () => {
  unsubscribeSessionEvents?.()
}

export const attachSessionEventListener = () => {
  try {
    const sessionManager = getSessionManager()
    if (!sessionManager) {
      error("Session manager not available")
      return
    }
    void sessionManager
      .init()
      .then(() => {
        unsubscribeSessionEvents?.()
        // Note: SessionManager now resolves delegate pubkeys to owner pubkeys internally
        // so pubKey is always the owner's pubkey, even for messages from delegate devices
        unsubscribeSessionEvents = sessionManager.onEvent((event, pubKey) => {
          const {publicKey} = useUserStore.getState()
          if (!publicKey) return

          // Block events from muted users
          const mutedUsers = getSocialGraph().getMutedByUser(publicKey)
          if (mutedUsers.has(pubKey)) return

          // Trigger desktop notification for DMs if on desktop
          if (isTauri() && event.pubkey !== publicKey) {
            import("./desktopNotifications").then(({handleDMEvent}) => {
              handleDMEvent(event, pubKey).catch(console.error)
            })
          }

          // Check if it's a group creation event
          const lTag = getTag("l", event.tags)
          if (event.kind === KIND_CHANNEL_CREATE && lTag) {
            try {
              const group = JSON.parse(event.content)
              const {addGroup} = useGroupsStore.getState()
              addGroup(group)
              log("Received group creation:", group.name, group.id)
            } catch (e) {
              error("Failed to parse group creation event:", e)
            }
            return
          }

          // Check if it's a group message (has l tag but not group creation)
          if (lTag) {
            // Create placeholder group if we don't have metadata yet
            const {groups, addGroup} = useGroupsStore.getState()
            if (!groups[lTag]) {
              const placeholderGroup = {
                id: lTag,
                name: `Group ${lTag.slice(0, 8)}`,
                description: "",
                picture: "",
                members: [publicKey],
                createdAt: Date.now(),
              }
              addGroup(placeholderGroup)
              log("Created placeholder group:", lTag)
            }

            // Group message or reaction - store under group ID
            log("Received group message for group:", lTag)
            void usePrivateMessagesStore.getState().upsert(lTag, publicKey, event)
            return
          }

          const pTag = getTag("p", event.tags)
          if (!pTag) return

          // from = the other party in the conversation
          // to = us (always our publicKey)
          const from = pubKey === publicKey ? pTag : pubKey
          const to = publicKey

          if (!from || !to) return

          void usePrivateMessagesStore.getState().upsert(from, to, event)
        })
      })
      .catch((err) => {
        error("Failed to initialize session manager (possibly corrupt data):", err)
      })
  } catch (err) {
    error("Failed to attach session event listener", err)
  }
}
