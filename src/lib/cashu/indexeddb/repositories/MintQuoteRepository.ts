import type {MintQuoteRepository} from "../../core/index"
import type {MintQuote} from "../../core/index"
import type {IdbDb, MintQuoteRow} from "../lib/db.ts"

export class IdbMintQuoteRepository implements MintQuoteRepository {
  private readonly db: IdbDb

  constructor(db: IdbDb) {
    this.db = db
  }

  async getMintQuote(mintUrl: string, quoteId: string): Promise<MintQuote | null> {
    const row = (await (this.db as any)
      .table("coco_cashu_mint_quotes")
      .get([mintUrl, quoteId])) as MintQuoteRow | undefined
    if (!row) return null
    const quote: MintQuote = {
      mintUrl: row.mintUrl,
      quote: row.quote,
      state: row.state,
      request: row.request,
      amount: row.amount,
      unit: row.unit,
      expiry: row.expiry,
      pubkey: row.pubkey ?? undefined,
      mintOutputs: row.mintOutputsJson ? JSON.parse(row.mintOutputsJson) : undefined,
      mintKeysetId: row.mintKeysetId,
    }
    return quote
  }

  async addMintQuote(quote: MintQuote): Promise<void> {
    const row: MintQuoteRow = {
      mintUrl: quote.mintUrl,
      quote: quote.quote,
      state: quote.state,
      request: quote.request,
      amount: quote.amount,
      unit: quote.unit,
      expiry: quote.expiry,
      pubkey: quote.pubkey ?? null,
      mintOutputsJson: quote.mintOutputs ? JSON.stringify(quote.mintOutputs) : undefined,
      mintKeysetId: quote.mintKeysetId,
    }
    await (this.db as any).table("coco_cashu_mint_quotes").put(row)
  }

  async setMintQuoteState(
    mintUrl: string,
    quoteId: string,
    state: MintQuote["state"]
  ): Promise<void> {
    await (this.db as any)
      .table("coco_cashu_mint_quotes")
      .update([mintUrl, quoteId], {state})
  }

  async getPendingMintQuotes(): Promise<MintQuote[]> {
    const rows = (await (this.db as any)
      .table("coco_cashu_mint_quotes")
      .toArray()) as MintQuoteRow[]
    return rows
      .filter((r) => r.state !== "ISSUED" || r.mintOutputsJson)
      .map((row) => ({
        mintUrl: row.mintUrl,
        quote: row.quote,
        state: row.state,
        request: row.request,
        amount: row.amount,
        unit: row.unit,
        expiry: row.expiry,
        pubkey: row.pubkey ?? undefined,
        mintOutputs: row.mintOutputsJson ? JSON.parse(row.mintOutputsJson) : undefined,
        mintKeysetId: row.mintKeysetId,
      }))
  }
}
