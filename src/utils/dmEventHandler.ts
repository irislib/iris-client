import {getSessionManager} from "@/shared/services/PrivateChats"
import {useUserStore} from "@/stores/user"
import {usePrivateMessagesStore} from "@/stores/privateMessages"
import {useGroupsStore} from "@/stores/groups"
import {useDevicesStore} from "@/stores/devices"
import {useTypingStore} from "@/stores/typingIndicators"
import {useMessagesStore} from "@/stores/messages"
import {useMessageRequestsStore} from "@/stores/messageRequests"
import type {MessageType} from "@/pages/chats/message/Message"
import {getTag} from "./tagUtils"
import {KIND_CHANNEL_CREATE, KIND_CHAT_MESSAGE, KIND_REACTION} from "./constants"
import {isTauri} from "./utils"
import {getSocialGraph} from "./socialGraph"
import {createDebugLogger} from "@/utils/createDebugLogger"
import {DEBUG_NAMESPACES} from "@/utils/constants"
import {isOwnDeviceEvent} from "@/utils/sessionRouting"
import {
  getMillisecondTimestamp,
  isTyping,
  parseReceipt,
  shouldAdvanceReceiptStatus,
  type Rumor,
} from "nostr-double-ratchet/src"

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
        unsubscribeSessionEvents = sessionManager.onEvent((event, pubKey) => {
          const {publicKey} = useUserStore.getState()
          if (!publicKey) return

          const {registeredDevices, identityPubkey} = useDevicesStore.getState()
          const isOwnDevice = isOwnDeviceEvent(
            event.pubkey,
            pubKey,
            publicKey,
            identityPubkey,
            registeredDevices
          )
          const effectiveOwner = isOwnDevice ? publicKey : pubKey

          // Block events from muted users
          const mutedUsers = getSocialGraph().getMutedByUser(publicKey)
          if (!isOwnDevice && mutedUsers.has(effectiveOwner)) return

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
            void usePrivateMessagesStore
              .getState()
              .upsert(lTag, publicKey, {...event, ownerPubkey: effectiveOwner})
            return
          }

          const pTag = getTag("p", event.tags)
          if (!pTag) return

          const from = isOwnDevice ? pTag : effectiveOwner
          const to = isOwnDevice ? publicKey : pTag

          if (!from || !to) return

          const chatId = from === publicKey ? to : from
          const receipt = parseReceipt(event)
          if (receipt) {
            const {events, updateMessage} = usePrivateMessagesStore.getState()
            const messageMap = events.get(chatId)
            if (!messageMap) return
            const receiptTimestamp = getMillisecondTimestamp(event as Rumor) || Date.now()
            for (const messageId of receipt.messageIds) {
              const existing = messageMap.get(messageId)
              if (!existing) continue
              const owner = existing.ownerPubkey ?? existing.pubkey
              if (owner !== publicKey) continue
              const updates: Partial<MessageType> = {}

              // A receipt implies our message made it to their device, so it must have
              // been published successfully to at least one relay.
              if (!existing.sentToRelays) updates.sentToRelays = true

              if (receipt.type === "delivered") {
                if (!existing.deliveredAt) updates.deliveredAt = receiptTimestamp
              } else if (receipt.type === "seen") {
                if (!existing.seenAt) updates.seenAt = receiptTimestamp
                // Seen implies delivered, and older DB rows may have status without timestamp.
                if (!existing.deliveredAt) updates.deliveredAt = receiptTimestamp
              }

              if (shouldAdvanceReceiptStatus(existing.status, receipt.type)) {
                updates.status = receipt.type
              }

              if (Object.keys(updates).length === 0) continue
              void updateMessage(chatId, messageId, updates)
            }
            return
          }

          const isMine = effectiveOwner === publicKey
          const {acceptedChats, rejectedChats} = useMessageRequestsStore.getState()
          const isLocallyAccepted = !!acceptedChats[chatId]
          const isLocallyRejected = !!rejectedChats[chatId]
          const isChatAccepted =
            // Followed users go straight to "All".
            getSocialGraph().isFollowing(publicKey, chatId) ||
            // Explicitly accepted requests (without following).
            isLocallyAccepted ||
            // Treat chats we've already sent to as accepted (request has been "accepted").
            (() => {
              const messageMap = usePrivateMessagesStore.getState().events.get(chatId)
              if (!messageMap) return false
              for (const msg of messageMap.values()) {
                const owner = msg.ownerPubkey ?? msg.pubkey
                if (owner === publicKey) return true
              }
              return false
            })()

          const {receiveMessageRequests} = useMessagesStore.getState()
          const shouldIgnoreRequest =
            !isMine &&
            !isChatAccepted &&
            (isLocallyRejected || receiveMessageRequests === false)

          // If the user disabled message requests (or previously rejected this user),
          // drop incoming events before they hit the message store.
          if (shouldIgnoreRequest) {
            return
          }

          if (isTyping(event)) {
            if (!isOwnDevice) {
              useTypingStore
                .getState()
                .setRemoteTyping(chatId, getMillisecondTimestamp(event))
            }
            return
          }

          // Trigger desktop notification for DMs if on desktop
          if (
            isTauri() &&
            !isOwnDevice &&
            event.pubkey !== publicKey &&
            event.kind === KIND_CHAT_MESSAGE
          ) {
            import("./desktopNotifications").then(({handleDMEvent}) => {
              handleDMEvent(event, effectiveOwner).catch(console.error)
            })
          }

          const isReaction = event.kind === KIND_REACTION
          if (!isReaction) {
            useTypingStore
              .getState()
              .clearRemoteTyping(chatId, getMillisecondTimestamp(event))
          }

          const existingMessage = usePrivateMessagesStore
            .getState()
            .events.get(chatId)
            ?.get(event.id)
          const existingStatus = existingMessage?.status
          const nextStatus =
            !isMine && !isReaction
              ? isChatAccepted
                ? existingStatus === "seen"
                  ? "seen"
                  : "delivered"
                : existingStatus
              : existingStatus

          void usePrivateMessagesStore.getState().upsert(from, to, {
            ...event,
            ownerPubkey: effectiveOwner,
            ...(nextStatus ? {status: nextStatus} : {}),
          })

          const {sendDeliveryReceipts} = useMessagesStore.getState()
          if (!isMine && !isReaction && sendDeliveryReceipts && isChatAccepted) {
            sessionManager.sendReceipt(from, "delivered", [event.id]).catch(() => {})
          }
        })
      })
      .catch((err) => {
        error("Failed to initialize session manager (possibly corrupt data):", err)
      })
  } catch (err) {
    error("Failed to attach session event listener", err)
  }
}
