import type {ReceiptType} from "nostr-double-ratchet"
import type {MessageType} from "@/pages/chats/message/Message"

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

export function markMessagesSeenAndMaybeSendReceipt({
  chatId,
  messages,
  myPubKey,
  updateMessage,
  sessionManager,
  sendReadReceipts,
  isChatAccepted,
}: {
  chatId: string
  messages: Iterable<MessageType>
  myPubKey: string
  updateMessage: UpdateMessageFn
  sessionManager: ReceiptSender
  sendReadReceipts: boolean
  isChatAccepted: boolean
}): string[] {
  if (!isChatAccepted) return []

  const toAck: string[] = []
  for (const message of messages) {
    const owner = message.ownerPubkey ?? message.pubkey
    if (owner === myPubKey) continue
    if (message.status === "seen") continue
    toAck.push(message.id)
  }

  if (toAck.length === 0) return []

  const seenAt = Date.now()
  for (const messageId of toAck) {
    void updateMessage(chatId, messageId, {status: "seen", seenAt})
  }

  if (sendReadReceipts) {
    sessionManager.sendReceipt(chatId, "seen", toAck).catch(() => {})
  }

  return toAck
}
