import type {MeltQuote} from "@core/models/MeltQuote"
import type {MeltQuoteRepository} from ".."

export class MemoryMeltQuoteRepository implements MeltQuoteRepository {
  private readonly quotes = new Map<string, MeltQuote>()

  private makeKey(mintUrl: string, quoteId: string): string {
    return `${mintUrl}::${quoteId}`
  }

  async getMeltQuote(mintUrl: string, quoteId: string): Promise<MeltQuote | null> {
    const key = this.makeKey(mintUrl, quoteId)
    return this.quotes.get(key) ?? null
  }

  async saveMeltQuote(quote: MeltQuote): Promise<void> {
    const key = this.makeKey(quote.mintUrl, quote.quote)
    this.quotes.set(key, quote)
  }

  async getPendingMeltQuotes(): Promise<MeltQuote[]> {
    const result: MeltQuote[] = []
    for (const q of this.quotes.values()) {
      if (q.state === "PENDING" || q.meltPreview) result.push(q)
    }
    return result
  }
}
