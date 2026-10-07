import type {MintQuote} from "@core/models/MintQuote"
import type {MintQuoteRepository} from ".."

export class MemoryMintQuoteRepository implements MintQuoteRepository {
  private readonly quotes = new Map<string, MintQuote>()

  private makeKey(mintUrl: string, quoteId: string): string {
    return `${mintUrl}::${quoteId}`
  }

  async getMintQuote(mintUrl: string, quoteId: string): Promise<MintQuote | null> {
    const key = this.makeKey(mintUrl, quoteId)
    return this.quotes.get(key) ?? null
  }

  async addMintQuote(quote: MintQuote): Promise<void> {
    const key = this.makeKey(quote.mintUrl, quote.quote)
    this.quotes.set(key, quote)
  }

  async setMintQuoteState(
    mintUrl: string,
    quoteId: string,
    state: MintQuote["state"]
  ): Promise<void> {
    const key = this.makeKey(mintUrl, quoteId)
    const existing = this.quotes.get(key)
    if (!existing) return
    this.quotes.set(key, {...existing, state})
  }

  async getPendingMintQuotes(): Promise<MintQuote[]> {
    const result: MintQuote[] = []
    for (const q of this.quotes.values()) {
      if (q.state !== "ISSUED" || q.mintOutputs) result.push(q)
    }
    return result
  }
}
