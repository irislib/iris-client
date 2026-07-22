import type {MeltQuoteResponse, MintQuoteResponse} from "@cashu/cashu-ts"
import type {
  MintQuoteService,
  MeltQuoteService,
  ReconcilePendingMeltsResult,
} from "@core/services"

export class QuotesApi {
  private mintQuoteService: MintQuoteService
  private meltQuoteService: MeltQuoteService
  constructor(mintQuoteService: MintQuoteService, meltQuoteService: MeltQuoteService) {
    this.mintQuoteService = mintQuoteService
    this.meltQuoteService = meltQuoteService
  }

  async createMintQuote(
    mintUrl: string,
    amount: number,
    description?: string
  ): Promise<MintQuoteResponse> {
    return this.mintQuoteService.createMintQuote(mintUrl, amount, description)
  }

  async redeemMintQuote(mintUrl: string, quoteId: string): Promise<void> {
    return this.mintQuoteService.redeemMintQuote(mintUrl, quoteId)
  }

  async createMeltQuote(mintUrl: string, invoice: string): Promise<MeltQuoteResponse> {
    return this.meltQuoteService.createMeltQuote(mintUrl, invoice)
  }

  async payMeltQuote(mintUrl: string, quoteId: string): Promise<MeltQuoteResponse> {
    return this.meltQuoteService.payMeltQuote(mintUrl, quoteId)
  }

  async reconcilePendingMelts(): Promise<ReconcilePendingMeltsResult> {
    return this.meltQuoteService.reconcilePendingMelts()
  }

  async addMintQuote(
    mintUrl: string,
    quotes: MintQuoteResponse[]
  ): Promise<{added: string[]; skipped: string[]}> {
    return this.mintQuoteService.addExistingMintQuotes(mintUrl, quotes)
  }

  async requeuePaidMintQuotes(mintUrl?: string): Promise<{requeued: string[]}> {
    return this.mintQuoteService.requeuePaidMintQuotes(mintUrl)
  }
}
