import {verifyEvent, type Event} from "nostr-tools"
import type {parseZapReceipt} from "@/utils/zapUtils"

type Receipt = NonNullable<ReturnType<typeof parseZapReceipt>>

type PostZap = {
  paymentKey: string
  sender: string | null
  amountMsats: bigint
  message: string
  createdAt: number
  id: string
}

export function readPostZap(receipt: Receipt, postId: string): PostZap | null {
  try {
    const request: Event = JSON.parse(receipt.event.tagValue("description") ?? "")
    const recipient = receipt.event.tagValue("p")
    const amountMsats = BigInt(receipt.amountMsats)
    if (
      amountMsats <= 0n ||
      request.kind !== 9734 ||
      !recipient ||
      !request.tags.some(([tag, id]) => tag === "e" && id === postId) ||
      !request.tags.some(([tag, key]) => tag === "p" && key === recipient) ||
      !verifyEvent(request)
    )
      return null
    const anonymous =
      request.tags.some(([tag]) => tag === "anon") ||
      receipt.event.tags.some(([tag]) => tag === "anon")
    return {
      paymentKey: receipt.paymentKey,
      sender: anonymous ? null : request.pubkey,
      amountMsats,
      message: !anonymous && request.content.trim() ? request.content : "",
      createdAt: receipt.event.created_at,
      id: receipt.id,
    }
  } catch {
    return null
  }
}

export type ZapSender = {sender: string | null; totalMsats: bigint; largest: PostZap}

function preferZap(candidate: PostZap, current: PostZap): boolean {
  if (candidate.amountMsats !== current.amountMsats)
    return candidate.amountMsats > current.amountMsats
  if (Boolean(candidate.message) !== Boolean(current.message))
    return Boolean(candidate.message)
  if (candidate.createdAt !== current.createdAt)
    return candidate.createdAt > current.createdAt
  return candidate.id < current.id
}

function addPostZap(senders: Map<string | null, ZapSender>, zap: PostZap) {
  const entry = senders.get(zap.sender)
  senders.set(zap.sender, {
    sender: zap.sender,
    totalMsats: (entry?.totalMsats ?? 0n) + zap.amountMsats,
    largest: !entry || preferZap(zap, entry.largest) ? zap : entry.largest,
  })
}

// Reissued receipts represent one payment. Prefer privacy on conflicts, then the
// earliest receipt so a reissue cannot move a message ahead of another equal tip.
function preferReceipt(candidate: PostZap, current: PostZap): boolean {
  if ((candidate.sender === null) !== (current.sender === null))
    return candidate.sender === null
  if (candidate.createdAt !== current.createdAt)
    return candidate.createdAt < current.createdAt
  return candidate.id < current.id
}

export class PostZapPayments {
  private payments = new Map<string, PostZap>()
  private senders = new Map<string | null, ZapSender>()
  private needsRegroup = false

  add(zap: PostZap): boolean {
    const previous = this.payments.get(zap.paymentKey)
    if (previous && !preferReceipt(zap, previous)) return false
    this.payments.set(zap.paymentKey, zap)
    if (previous) this.needsRegroup = true
    if (!this.needsRegroup) addPostZap(this.senders, zap)
    return true
  }

  orderedSenders(): ZapSender[] {
    // Ordinary arrivals update one sender. Coalesce conflicting replacements
    // into one rebuild per snapshot to remove displaced amounts and messages.
    if (this.needsRegroup) {
      this.senders.clear()
      for (const zap of this.payments.values()) addPostZap(this.senders, zap)
      this.needsRegroup = false
    }
    return [...this.senders.values()].sort((a, b) => {
      if (a.totalMsats !== b.totalMsats) return a.totalMsats > b.totalMsats ? -1 : 1
      return (a.sender ?? "").localeCompare(b.sender ?? "")
    })
  }
}
