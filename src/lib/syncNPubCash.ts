import type {Signer} from "./nostr"
import type {Manager} from "./cashu/core"
import {getNPubCashQuotes} from "./npubcash"

export interface NPubCashSyncResult {
  pending: number
  error?: string
}

/** Import every page; quote records, rather than a timestamp cursor, prevent reclaims. */
export async function syncNPubCashPayments(
  signer: Signer,
  manager: Manager,
  isCurrent = () => true
): Promise<NPubCashSyncResult> {
  const quotes = await getNPubCashQuotes(signer)
  const result: NPubCashSyncResult = {pending: 0}
  const unavailableMints = new Set<string>()
  for (const quote of quotes) {
    if (!isCurrent()) return result
    const existing = await manager.quotes.getMintQuote(quote.mintUrl, quote.quoteId)
    if (existing?.state === "ISSUED" && !existing.mintOutputs) continue
    if (!existing && quote.state === "ISSUED") continue
    if (quote.locked) {
      result.pending += quote.amount
      result.error = "Some payments require a wallet that supports locked mint quotes."
      continue
    }
    if (quote.state === "INFLIGHT") {
      result.pending += quote.amount
      continue
    }
    try {
      if (unavailableMints.has(quote.mintUrl)) throw new Error("Mint unavailable")
      try {
        await manager.mint.addMint(quote.mintUrl)
      } catch (error) {
        unavailableMints.add(quote.mintUrl)
        throw error
      }
      if (!isCurrent()) return result
      if (!existing) {
        await manager.quotes.addMintQuote(quote.mintUrl, [
          {
            quote: quote.quoteId,
            request: quote.request,
            amount: quote.amount,
            unit: "sat",
            state: "PAID",
            expiry: quote.expiresAt,
          },
        ])
      }
      if (!isCurrent()) return result
      await manager.quotes.redeemMintQuote(quote.mintUrl, quote.quoteId)
    } catch {
      result.pending += quote.amount
      result.error =
        "Could not receive some payments from the mint. They will be retried automatically."
    }
  }
  return result
}
