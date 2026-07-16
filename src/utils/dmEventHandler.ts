import {useUserStore} from "@/stores/user"
import {usePrivateMessagesStore} from "@/stores/privateMessages"
import {useDevicesStore} from "@/stores/devices"
import {useTypingStore} from "@/stores/typingIndicators"
import {useMessagesStore} from "@/stores/messages"
import {useMessageRequestsStore} from "@/stores/messageRequests"
import type {MessageType} from "@/pages/chats/message/Message"
import {getTag} from "./tagUtils"
import {KIND_CHAT_SETTINGS, KIND_REACTION} from "./constants"
import {getSocialGraph} from "./socialGraph"
import {createDebugLogger} from "@/utils/createDebugLogger"
import {DEBUG_NAMESPACES} from "@/utils/constants"
import {
  isOwnDeviceEvent,
  isOwnDevicePubkey,
  resolveSessionPubkeyToOwner,
} from "@/utils/sessionRouting"
import {isPrivateChatAccepted} from "@/utils/privateChatAcceptance"
import {useChatExpirationStore} from "@/stores/chatExpiration"
import {parseChatSettingsMessage} from "@/utils/chatSettings"
import {
  getMillisecondTimestamp,
  isTyping,
  parseReceipt,
  shouldAdvanceReceiptStatus,
  type Rumor,
  type NdrRuntime,
} from "nostr-double-ratchet"

const {error} = createDebugLogger(DEBUG_NAMESPACES.UTILS)

type SessionEventRuntime = Pick<
  NdrRuntime,
  | "onSessionEvent"
  | "getSessionUserRecords"
  | "setExpirationForPeer"
  | "setExpirationForGroup"
  | "sendReceipt"
>

let unsubscribeRuntimeEvents: (() => void) | null = null

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

export const cleanupNdrRuntimeEventListener = () => {
  unsubscribeRuntimeEvents?.()
  unsubscribeRuntimeEvents = null
}

export const attachNdrRuntimeEventListener = (runtime: SessionEventRuntime) => {
  try {
    unsubscribeRuntimeEvents?.()
    unsubscribeRuntimeEvents = runtime.onSessionEvent((event, pubKey, meta) => {
      const {publicKey} = useUserStore.getState()
      if (!publicKey) return

      const {registeredDevices, identityPubkey} = useDevicesStore.getState()
      const isOwnDevice =
        meta?.isSelf ??
        isOwnDeviceEvent(
          event.pubkey,
          pubKey,
          publicKey,
          identityPubkey,
          registeredDevices
        )
      const effectiveOwner = isOwnDevice ? publicKey : meta?.senderOwnerPubkey || pubKey
      const sessionUserRecords = runtime.getSessionUserRecords()

      // Block events from muted users
      const mutedUsers = getSocialGraph().getMutedByUser(publicKey)
      if (!isOwnDevice && mutedUsers.has(effectiveOwner)) return

      const lTag = getTag("l", event.tags)
      if (lTag) {
        // The runtime's authenticated group controller exclusively owns l-tagged
        // traffic, including sender-key control records and pairwise group events.
        return
      }

      const pTag = getTag("p", event.tags)
      if (!pTag) return

      const pTagIsOwnDevice = isOwnDevicePubkey(
        pTag,
        publicKey,
        identityPubkey,
        registeredDevices
      )
      const resolvedPTag = pTagIsOwnDevice
        ? publicKey
        : resolveSessionPubkeyToOwner(sessionUserRecords, pTag)
      const isSelfChat = effectiveOwner === publicKey && pTagIsOwnDevice

      let from = effectiveOwner
      let to = resolvedPTag
      if (isSelfChat) {
        from = publicKey
        to = publicKey
      } else if (isOwnDevice) {
        from = resolvedPTag
        to = publicKey
      }

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
      const messageMap = usePrivateMessagesStore.getState().events.get(chatId)
      const isChatAccepted = isPrivateChatAccepted({
        recipientPubkey: chatId,
        isFollowed: getSocialGraph().isFollowing(publicKey, chatId),
        isLocallyAccepted,
        messages: messageMap?.values(),
        myPubKey: publicKey,
        sessionUserRecords,
      })

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

          runtime
            .setExpirationForPeer(
              chatId,
              settings.messageTtlSeconds ? {ttlSeconds: settings.messageTtlSeconds} : null
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
        runtime.sendReceipt(from, "delivered", [event.id]).catch(() => {})
      }
    })
  } catch (err) {
    error("Failed to attach NdrRuntime event listener", err)
  }
}
