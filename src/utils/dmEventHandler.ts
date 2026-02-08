import {getSessionManager} from "@/shared/services/PrivateChats"
import {useUserStore} from "@/stores/user"
import {usePrivateMessagesStore} from "@/stores/privateMessages"
import {useGroupsStore} from "@/stores/groups"
import {useDevicesStore} from "@/stores/devices"
import {useGroupSenderKeysStore} from "@/stores/groupSenderKeys"
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
  applyMetadataUpdate,
  getMillisecondTimestamp,
  GROUP_SENDER_KEY_DISTRIBUTION_KIND,
  isTyping,
  parseReceipt,
  parseGroupMetadata,
  shouldAdvanceReceiptStatus,
  type SenderKeyDistribution,
  type Rumor,
  validateMetadataCreation,
} from "nostr-double-ratchet"

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

          const lTag = getTag("l", event.tags)
          if (lTag) {
            // Group metadata (kind 40): add/update group and store the invite message.
            if (event.kind === KIND_CHANNEL_CREATE) {
              const {groups, addGroup} = useGroupsStore.getState()

              try {
                const metadata = parseGroupMetadata(event.content)
                if (
                  metadata &&
                  validateMetadataCreation(metadata, effectiveOwner, publicKey)
                ) {
                  const existing = groups[metadata.id]
                  const createdAt = getMillisecondTimestamp(event as Rumor) || Date.now()
                  addGroup(
                    existing
                      ? applyMetadataUpdate(existing, metadata)
                      : {
                          id: metadata.id,
                          name: metadata.name,
                          description: metadata.description,
                          picture: metadata.picture,
                          members: metadata.members,
                          admins: metadata.admins,
                          createdAt,
                          secret: metadata.secret,
                          accepted: true,
                        }
                  )
                  log("Received group metadata:", metadata.name, metadata.id)

                  void usePrivateMessagesStore
                    .getState()
                    .upsert(metadata.id, publicKey, {
                      ...event,
                      ownerPubkey: effectiveOwner,
                    })
                  return
                }
              } catch (e) {
                error("Failed to parse group metadata:", e)
              }

              // Legacy fallback: old clients sent a full Group object as JSON.
              try {
                const legacy = JSON.parse(event.content) as any
                if (legacy && typeof legacy.id === "string") {
                  const createdAt =
                    typeof legacy.createdAt === "number"
                      ? legacy.createdAt
                      : getMillisecondTimestamp(event as Rumor) || Date.now()
                  addGroup({
                    id: legacy.id,
                    name: legacy.name || `Group ${legacy.id.slice(0, 8)}`,
                    description: legacy.description || "",
                    picture: legacy.picture || "",
                    members: Array.isArray(legacy.members) ? legacy.members : [publicKey],
                    admins: Array.isArray(legacy.admins) && legacy.admins.length > 0
                      ? legacy.admins
                      : [effectiveOwner],
                    createdAt,
                    secret: typeof legacy.secret === "string" ? legacy.secret : undefined,
                    accepted: true,
                  })
                  log("Received legacy group creation:", legacy.name, legacy.id)
                  void usePrivateMessagesStore
                    .getState()
                    .upsert(legacy.id, publicKey, {
                      ...event,
                      ownerPubkey: effectiveOwner,
                    })
                  return
                }
              } catch (e) {
                error("Failed to parse legacy group creation event:", e)
              }

              return
            }

            // Sender-key distribution: store keys but do not show as a message.
            if (event.kind === GROUP_SENDER_KEY_DISTRIBUTION_KIND) {
              try {
                const parsed = JSON.parse(event.content) as SenderKeyDistribution
                const dist: SenderKeyDistribution = {
                  ...parsed,
                  groupId: parsed.groupId || lTag,
                }

                if (!dist.groupId || !dist.senderEventPubkey) return
                if (typeof dist.keyId !== "number" || typeof dist.chainKey !== "string") return
                if (typeof dist.iteration !== "number" || typeof dist.createdAt !== "number") return

                useGroupSenderKeysStore.getState().upsertDistribution(dist, effectiveOwner)

                // Ensure the group exists for navigation/UI even if metadata arrives later.
                const {groups, addGroup} = useGroupsStore.getState()
                if (!groups[dist.groupId]) {
                  addGroup({
                    id: dist.groupId,
                    name: `Group ${dist.groupId.slice(0, 8)}`,
                    description: "",
                    picture: "",
                    members: [publicKey],
                    admins: [publicKey],
                    createdAt: Date.now(),
                    accepted: true,
                  })
                  log("Created placeholder group from sender-key distribution:", dist.groupId)
                }
              } catch (e) {
                error("Failed to parse sender-key distribution:", e)
              }
              return
            }

            // Legacy group message (double-ratchet fan-out): store under group ID.
            const {groups, addGroup} = useGroupsStore.getState()
            if (!groups[lTag]) {
              addGroup({
                id: lTag,
                name: `Group ${lTag.slice(0, 8)}`,
                description: "",
                picture: "",
                members: [publicKey],
                admins: [publicKey],
                createdAt: Date.now(),
                accepted: true,
              })
              log("Created placeholder group:", lTag)
            }

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
          let nextStatus = existingStatus
          if (!isMine && !isReaction && isChatAccepted) {
            nextStatus = existingStatus === "seen" ? "seen" : "delivered"
          }

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
