import type {MeltQuote, MeltQuoteRepository, PersistedMeltPreview} from "../../core/index"
import type {IdbDb, MeltQuoteRow} from "../lib/db.ts"

export class IdbMeltQuoteRepository implements MeltQuoteRepository {
  private readonly db: IdbDb

  constructor(db: IdbDb) {
    this.db = db
  }

  private get table() {
    return this.db.table<MeltQuoteRow, [string, string]>("coco_cashu_melt_quotes")
  }

  async getMeltQuote(mintUrl: string, quoteId: string): Promise<MeltQuote | null> {
    const row = await this.table.get([mintUrl, quoteId])
    if (!row) return null
    const quote: MeltQuote = {
      mintUrl: row.mintUrl,
      quote: row.quote,
      state: row.state,
      request: row.request,
      amount: row.amount,
      unit: row.unit,
      expiry: row.expiry,
      fee_reserve: row.fee_reserve,
      payment_preimage: row.payment_preimage,
      meltPreview: row.meltPreviewJson
        ? (JSON.parse(row.meltPreviewJson) as PersistedMeltPreview)
        : null,
    }
    return quote
  }

  async saveMeltQuote(quote: MeltQuote): Promise<void> {
    const row: MeltQuoteRow = {
      mintUrl: quote.mintUrl,
      quote: quote.quote,
      state: quote.state,
      request: quote.request,
      amount: quote.amount,
      unit: quote.unit,
      expiry: quote.expiry,
      fee_reserve: quote.fee_reserve,
      payment_preimage: quote.payment_preimage ?? null,
      meltPreviewJson: quote.meltPreview ? JSON.stringify(quote.meltPreview) : null,
    }
    await this.table.put(row)
  }

  async getPendingMeltQuotes(): Promise<MeltQuote[]> {
    const rows = await this.table.toArray()
    return rows
      .filter((row) => row.state === "PENDING" || row.meltPreviewJson)
      .map((row) => ({
        mintUrl: row.mintUrl,
        quote: row.quote,
        state: row.state,
        request: row.request,
        amount: row.amount,
        unit: row.unit,
        expiry: row.expiry,
        fee_reserve: row.fee_reserve,
        payment_preimage: row.payment_preimage,
        meltPreview: row.meltPreviewJson
          ? (JSON.parse(row.meltPreviewJson) as PersistedMeltPreview)
          : null,
      }))
  }
}
