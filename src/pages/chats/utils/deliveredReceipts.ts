import type {ReceiptType} from "nostr-double-ratchet/src"
import type {MessageType} from "@/pages/chats/message/Message"

import {KIND_REACTION} from "@/utils/constants"

type UpdateMessageFn = (
  chatId: string,
  messageId: string,
  updates: Partial<MessageType>
) => Promise<void>

type ReceiptSender = {
  sendReceipt: (
    chatId: string,
    type: ReceiptType,
    messageIds: string[]
  ) => Promise<unknown>
}

export function markMessagesDeliveredAndMaybeSendReceipt({
  chatId,
  messages,
  myPubKey,
  updateMessage,
  sessionManager,
  sendDeliveryReceipts,
  isChatAccepted,
}: {
  chatId: string
  messages: Iterable<MessageType>
  myPubKey: string
  updateMessage: UpdateMessageFn
  sessionManager: ReceiptSender
  sendDeliveryReceipts: boolean
  isChatAccepted: boolean
}): string[] {
  if (!isChatAccepted) return []

  const toAck: string[] = []
  for (const message of messages) {
    const owner = message.ownerPubkey ?? message.pubkey
    if (owner === myPubKey) continue
    if (message.kind === KIND_REACTION) continue
    if (message.status === "delivered" || message.status === "seen") continue
    toAck.push(message.id)
  }

  if (toAck.length === 0) return []

  const deliveredAt = Date.now()
  for (const messageId of toAck) {
    void updateMessage(chatId, messageId, {status: "delivered", deliveredAt})
  }

  if (sendDeliveryReceipts) {
    sessionManager.sendReceipt(chatId, "delivered", toAck).catch(() => {})
  }

  return toAck
}
