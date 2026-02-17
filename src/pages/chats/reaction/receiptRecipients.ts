export type ReceiptRecipient = {
  pubkey: string
  timestamp: number
}

export const normalizeReceiptRecipients = (
  recipients?: ReceiptRecipient[]
): ReceiptRecipient[] => {
  if (!recipients || recipients.length === 0) return []

  const byPubkey = new Map<string, ReceiptRecipient>()
  for (const recipient of recipients) {
    const existing = byPubkey.get(recipient.pubkey)
    if (!existing || recipient.timestamp < existing.timestamp) {
      byPubkey.set(recipient.pubkey, recipient)
    }
  }

  return Array.from(byPubkey.values()).sort((a, b) => {
    if (a.timestamp === b.timestamp) {
      return a.pubkey.localeCompare(b.pubkey)
    }
    return a.timestamp - b.timestamp
  })
}

export const getReceiptRecipientsForDisplay = ({
  deliveredTo,
  seenBy,
}: {
  deliveredTo?: ReceiptRecipient[]
  seenBy?: ReceiptRecipient[]
}) => {
  const normalizedSeenBy = normalizeReceiptRecipients(seenBy)
  const seenPubkeys = new Set(normalizedSeenBy.map((recipient) => recipient.pubkey))

  const normalizedDeliveredTo = normalizeReceiptRecipients(deliveredTo).filter(
    (recipient) => !seenPubkeys.has(recipient.pubkey)
  )

  return {
    deliveredTo: normalizedDeliveredTo,
    seenBy: normalizedSeenBy,
  }
}
