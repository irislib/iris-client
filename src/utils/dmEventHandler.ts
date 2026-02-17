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
import {
  KIND_CHANNEL_CREATE,
  KIND_CHAT_MESSAGE,
  KIND_CHAT_SETTINGS,
  KIND_REACTION,
} from "./constants"
import {isTauri} from "./utils"
import {getSocialGraph} from "./socialGraph"
import {createDebugLogger} from "@/utils/createDebugLogger"
import {DEBUG_NAMESPACES} from "@/utils/constants"
import {isOwnDeviceEvent} from "@/utils/sessionRouting"
import {useChatExpirationStore} from "@/stores/chatExpiration"
import {parseChatSettingsMessage} from "@/utils/chatSettings"
import {ingestGroupSessionEvent} from "@/utils/groupTransport"
import {
  applyMetadataUpdate,
  getMillisecondTimestamp,
  GROUP_SENDER_KEY_DISTRIBUTION_KIND,
  isTyping,
  parseReceipt,
  parseGroupMetadata,
  shouldAdvanceReceiptStatus,
  type Rumor,
  validateMetadataCreation,
  validateMetadataUpdate,
} from "nostr-double-ratchet"

const {log, error} = createDebugLogger(DEBUG_NAMESPACES.UTILS)

let unsubscribeSessionEvents: (() => void) | null = null

const upsertReceiptRecipient = (
  existing:
    | Array<{
        pubkey: string
        timestamp: number
      }>
    | undefined,
  pubkey: string,
  timestamp: number
) => {
  const next = existing ? [...existing] : []
  const existingIndex = next.findIndex((entry) => entry.pubkey === pubkey)
  if (existingIndex === -1) {
    next.push({pubkey, timestamp})
  } else {
    const current = next[existingIndex]
    // Keep the earliest receipt timestamp for each user.
    if (timestamp < current.timestamp) {
      next[existingIndex] = {...current, timestamp}
    }
  }

  next.sort((a, b) => {
    if (a.timestamp === b.timestamp) return a.pubkey.localeCompare(b.pubkey)
    return a.timestamp - b.timestamp
  })

  return next
}

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
              const {groups, addGroup, removeGroup} = useGroupsStore.getState()

              try {
                const metadata = parseGroupMetadata(event.content)
                if (metadata) {
                  const existing = groups[metadata.id]
                  const metadataSenderPubkey = metadata.admins.includes(event.pubkey)
                    ? event.pubkey
                    : effectiveOwner

                  const hasTtl = Object.prototype.hasOwnProperty.call(
                    metadata as unknown as Record<string, unknown>,
                    "messageTtlSeconds"
                  )
                  const rawTtl = (metadata as unknown as Record<string, unknown>)
                    .messageTtlSeconds
                  let nextTtl: number | null | undefined
                  if (rawTtl === null) {
                    nextTtl = null
                  } else if (typeof rawTtl === "number" && Number.isFinite(rawTtl)) {
                    const floored = Math.floor(rawTtl)
                    nextTtl = floored > 0 ? floored : null
                  } else {
                    nextTtl = undefined
                  }

                  if (existing) {
                    const isPlaceholderGroup =
                      !existing.secret &&
                      existing.members.length === 1 &&
                      existing.members[0] === publicKey &&
                      existing.admins.length === 1 &&
                      existing.admins[0] === publicKey &&
                      typeof existing.name === "string" &&
                      existing.name.startsWith("Group ")

                    // Placeholder groups are created from sender-key distribution or legacy group
                    // messages before metadata arrives. In that case, accept the first metadata
                    // message as a "creation" (validate against the metadata itself).
                    if (isPlaceholderGroup) {
                      if (
                        !validateMetadataCreation(
                          metadata,
                          metadataSenderPubkey,
                          publicKey
                        )
                      ) {
                        return
                      }
                      addGroup(applyMetadataUpdate(existing, metadata))
                    } else {
                      const verdict = validateMetadataUpdate(
                        existing,
                        metadata,
                        metadataSenderPubkey,
                        publicKey
                      )
                      if (verdict === "reject") {
                        return
                      }

                      if (verdict === "removed") {
                        removeGroup(metadata.id)
                        useChatExpirationStore.getState().clearExpiration(metadata.id)
                        void usePrivateMessagesStore.getState().removeSession(metadata.id)
                        log("Removed from group:", metadata.id)
                        return
                      }

                      addGroup(applyMetadataUpdate(existing, metadata))
                    }
                  } else {
                    if (
                      !validateMetadataCreation(metadata, metadataSenderPubkey, publicKey)
                    ) {
                      return
                    }

                    const createdAt =
                      getMillisecondTimestamp(event as Rumor) || Date.now()
                    addGroup({
                      id: metadata.id,
                      name: metadata.name,
                      description: metadata.description,
                      picture: metadata.picture,
                      members: metadata.members,
                      admins: metadata.admins,
                      createdAt,
                      secret: metadata.secret,
                      accepted: true,
                    })
                  }

                  if (existing && hasTtl && nextTtl !== undefined) {
                    useGroupsStore.getState().updateGroup(metadata.id, {
                      messageTtlSeconds: nextTtl,
                    })
                  } else if (!existing) {
                    useGroupsStore.getState().updateGroup(metadata.id, {
                      messageTtlSeconds: nextTtl ?? null,
                    })
                  }

                  if (hasTtl && nextTtl !== undefined) {
                    useChatExpirationStore.getState().setExpiration(metadata.id, nextTtl)
                    sessionManager
                      .setExpirationForGroup(
                        metadata.id,
                        nextTtl ? {ttlSeconds: nextTtl} : null
                      )
                      .catch(() => {})
                  }

                  log("Received group metadata:", metadata.name, metadata.id)

                  void usePrivateMessagesStore.getState().upsert(metadata.id, publicKey, {
                    ...event,
                    ownerPubkey: metadataSenderPubkey,
                  })
                  return
                }
              } catch (e) {
                error("Failed to parse group metadata:", e)
              }

              // Legacy fallback: old clients sent a full Group object as JSON.
              try {
                const legacy = JSON.parse(event.content) as unknown
                if (!legacy || typeof legacy !== "object") return

                const obj = legacy as Record<string, unknown>
                if (typeof obj.id === "string") {
                  const createdAt =
                    typeof obj.createdAt === "number"
                      ? obj.createdAt
                      : getMillisecondTimestamp(event as Rumor) || Date.now()
                  const legacyId = obj.id
                  const legacyName = typeof obj.name === "string" ? obj.name : ""
                  const legacyDescription =
                    typeof obj.description === "string" ? obj.description : ""
                  const legacyPicture = typeof obj.picture === "string" ? obj.picture : ""
                  const legacyMembers = Array.isArray(obj.members)
                    ? obj.members.filter((m): m is string => typeof m === "string")
                    : [publicKey]
                  const legacyAdmins =
                    Array.isArray(obj.admins) && obj.admins.length > 0
                      ? obj.admins.filter((a): a is string => typeof a === "string")
                      : [effectiveOwner]

                  addGroup({
                    id: legacyId,
                    name: legacyName || `Group ${legacyId.slice(0, 8)}`,
                    description: legacyDescription,
                    picture: legacyPicture,
                    members: legacyMembers.length > 0 ? legacyMembers : [publicKey],
                    admins: legacyAdmins.length > 0 ? legacyAdmins : [effectiveOwner],
                    createdAt,
                    secret: typeof obj.secret === "string" ? obj.secret : undefined,
                    accepted: true,
                  })
                  log("Received legacy group creation:", legacyName, legacyId)
                  void usePrivateMessagesStore.getState().upsert(legacyId, publicKey, {
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
              const rawGroupId =
                (() => {
                  try {
                    const parsed = JSON.parse(event.content) as {groupId?: unknown}
                    return typeof parsed.groupId === "string" ? parsed.groupId : undefined
                  } catch {
                    return undefined
                  }
                })() || lTag

              if (!rawGroupId) return

              const {groups, addGroup} = useGroupsStore.getState()
              if (!groups[rawGroupId]) {
                const members = [publicKey]
                if (effectiveOwner !== publicKey) {
                  members.push(effectiveOwner)
                }
                addGroup({
                  id: rawGroupId,
                  name: `Group ${rawGroupId.slice(0, 8)}`,
                  description: "",
                  picture: "",
                  members,
                  admins: [publicKey],
                  createdAt: Date.now(),
                  accepted: true,
                })
                log("Created placeholder group from sender-key distribution:", rawGroupId)
              }

              void ingestGroupSessionEvent(event as Rumor, effectiveOwner, event.pubkey).catch(
                (e) => {
                  error("Failed to ingest sender-key distribution:", e)
                }
              )
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
            const {events, updateMessage, updateLastSeen, lastSeen} =
              usePrivateMessagesStore.getState()
            const messageMap = events.get(chatId)
            if (!messageMap) return
            const receiptTimestamp = getMillisecondTimestamp(event as Rumor) || Date.now()
            let latestSeenIncomingTimestamp = 0
            for (const messageId of receipt.messageIds) {
              const existing = messageMap.get(messageId)
              if (!existing) continue
              const owner = existing.ownerPubkey ?? existing.pubkey
              if (!isOwnDevice && owner !== publicKey) continue
              if (isOwnDevice && owner === publicKey) continue
              const updates: Partial<MessageType> = {}

              // A receipt implies our message made it to their device, so it must have
              // been published successfully to at least one relay.
              if (!isOwnDevice && !existing.sentToRelays) updates.sentToRelays = true

              if (receipt.type === "delivered") {
                if (!existing.deliveredAt) updates.deliveredAt = receiptTimestamp
                updates.deliveredTo = upsertReceiptRecipient(
                  existing.deliveredTo,
                  effectiveOwner,
                  receiptTimestamp
                )
              } else if (receipt.type === "seen") {
                if (!existing.seenAt) updates.seenAt = receiptTimestamp
                // Seen implies delivered, and older DB rows may have status without timestamp.
                if (!existing.deliveredAt) updates.deliveredAt = receiptTimestamp
                updates.deliveredTo = upsertReceiptRecipient(
                  existing.deliveredTo,
                  effectiveOwner,
                  receiptTimestamp
                )
                updates.seenBy = upsertReceiptRecipient(
                  existing.seenBy,
                  effectiveOwner,
                  receiptTimestamp
                )
                if (isOwnDevice) {
                  latestSeenIncomingTimestamp = Math.max(
                    latestSeenIncomingTimestamp,
                    getMillisecondTimestamp(existing)
                  )
                }
              }

              if (shouldAdvanceReceiptStatus(existing.status, receipt.type)) {
                updates.status = receipt.type
              }

              if (Object.keys(updates).length === 0) continue
              void updateMessage(chatId, messageId, updates)
            }
            if (isOwnDevice && receipt.type === "seen") {
              const currentLastSeen = lastSeen.get(chatId) || 0
              if (latestSeenIncomingTimestamp > currentLastSeen) {
                updateLastSeen(chatId, latestSeenIncomingTimestamp)
              }
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

          if (event.kind === KIND_CHAT_SETTINGS) {
            const settings = parseChatSettingsMessage(event.content)
            if (settings) {
              useChatExpirationStore
                .getState()
                .setExpiration(chatId, settings.messageTtlSeconds)

              sessionManager
                .setExpirationForPeer(
                  chatId,
                  settings.messageTtlSeconds
                    ? {ttlSeconds: settings.messageTtlSeconds}
                    : null
                )
                .catch(() => {})
            }
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
