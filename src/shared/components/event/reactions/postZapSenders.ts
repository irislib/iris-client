import {verifyEvent, type Event} from "nostr-tools"
import type {parseZapReceipt} from "@/utils/zapUtils"

type Receipt = NonNullable<ReturnType<typeof parseZapReceipt>>

type PostZap = {
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

export function addPostZap(senders: Map<string | null, ZapSender>, zap: PostZap) {
  const entry = senders.get(zap.sender)
  senders.set(zap.sender, {
    sender: zap.sender,
    totalMsats: (entry?.totalMsats ?? 0n) + zap.amountMsats,
    largest: !entry || preferZap(zap, entry.largest) ? zap : entry.largest,
  })
}

export function orderedZapSenders(senders: Map<string | null, ZapSender>) {
  return [...senders.values()].sort((a, b) => {
    if (a.totalMsats !== b.totalMsats) return a.totalMsats > b.totalMsats ? -1 : 1
    return (a.sender ?? "").localeCompare(b.sender ?? "")
  })
}
