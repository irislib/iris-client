import type {MintQuoteRepository} from "../repositories"
import type {WalletService} from "./WalletService"
import type {ProofService} from "./ProofService"
import type {MintQuoteResponse, MintQuoteState} from "@cashu/cashu-ts"
import type {CoreEvents, EventBus} from "@core/events"
import type {Logger} from "../logging/Logger.ts"
import {mapProofToCoreProof} from "@core/utils.ts"

export class MintQuoteService {
  private readonly mintQuoteRepo: MintQuoteRepository
  private readonly walletService: WalletService
  private readonly proofService: ProofService
  private readonly eventBus: EventBus<CoreEvents>
  private readonly logger?: Logger

  constructor(
    mintQuoteRepo: MintQuoteRepository,
    walletService: WalletService,
    proofService: ProofService,
    eventBus: EventBus<CoreEvents>,
    logger?: Logger
  ) {
    this.mintQuoteRepo = mintQuoteRepo
    this.walletService = walletService
    this.proofService = proofService
    this.eventBus = eventBus
    this.logger = logger
  }

  async createMintQuote(
    mintUrl: string,
    amount: number,
    description?: string
  ): Promise<MintQuoteResponse> {
    this.logger?.info("Creating mint quote", {mintUrl, amount, description})
    try {
      const {wallet} = await this.walletService.getWalletWithActiveKeysetId(mintUrl)
      const quote = await wallet.createMintQuote(amount, description)
      await this.mintQuoteRepo.addMintQuote({...quote, mintUrl})
      await this.eventBus.emit("mint-quote:created", {
        mintUrl,
        quoteId: quote.quote,
        quote,
      })
      return quote
    } catch (err) {
      this.logger?.error("Failed to create mint quote", {mintUrl, amount, err})
      throw err
    }
  }

  async redeemMintQuote(mintUrl: string, quoteId: string): Promise<void> {
    this.logger?.info("Redeeming mint quote", {mintUrl, quoteId})
    try {
      const quote = await this.mintQuoteRepo.getMintQuote(mintUrl, quoteId)
      if (!quote) {
        this.logger?.warn("Mint quote not found", {mintUrl, quoteId})
        throw new Error("Quote not found")
      }
      const wallet = await this.walletService.getWallet(mintUrl)
      // Get keyset that matches the quote's unit
      const matchingKeyset = wallet.keysets.find((k) => k.unit === quote.unit && k.active)
      if (!matchingKeyset) {
        throw new Error(
          `No active keyset found for unit ${quote.unit} at mint ${mintUrl}`
        )
      }
      const {keep} = await this.proofService.createOutputsAndIncrementCounters(mintUrl, {
        keep: quote.amount,
        send: 0,
      })
      const proofs = await wallet.mintProofs(quote.amount, quote.quote, {
        outputData: keep,
      })
      await this.eventBus.emit("mint-quote:redeemed", {mintUrl, quoteId, quote})
      this.logger?.info("Mint quote redeemed, proofs minted", {
        mintUrl,
        quoteId,
        amount: quote.amount,
        proofs: proofs.length,
      })
      await this.setMintQuoteState(mintUrl, quoteId, "ISSUED")
      await this.proofService.saveProofs(
        mintUrl,
        mapProofToCoreProof(mintUrl, "ready", proofs)
      )
      this.logger?.debug("Proofs saved to repository", {mintUrl, count: proofs.length})
    } catch (err) {
      this.logger?.error("Failed to redeem mint quote", {mintUrl, quoteId, err})
      throw err
    }
  }

  async addExistingMintQuotes(
    mintUrl: string,
    quotes: MintQuoteResponse[]
  ): Promise<{added: string[]; skipped: string[]}> {
    this.logger?.info("Adding existing mint quotes", {mintUrl, count: quotes.length})

    const added: string[] = []
    const skipped: string[] = []

    for (const quote of quotes) {
      try {
        // Check if quote already exists
        const existing = await this.mintQuoteRepo.getMintQuote(mintUrl, quote.quote)
        if (existing) {
          this.logger?.debug("Quote already exists, skipping", {
            mintUrl,
            quoteId: quote.quote,
          })
          skipped.push(quote.quote)
          continue
        }

        // Add the quote to the repository
        await this.mintQuoteRepo.addMintQuote({...quote, mintUrl})
        added.push(quote.quote)

        // Emit the added event - processor will handle PAID quotes
        await this.eventBus.emit("mint-quote:added", {
          mintUrl,
          quoteId: quote.quote,
          quote,
        })

        this.logger?.debug("Added existing mint quote", {
          mintUrl,
          quoteId: quote.quote,
          state: quote.state,
        })
      } catch (err) {
        this.logger?.error("Failed to add existing mint quote", {
          mintUrl,
          quoteId: quote.quote,
          err,
        })
        skipped.push(quote.quote)
      }
    }

    this.logger?.info("Finished adding existing mint quotes", {
      mintUrl,
      added: added.length,
      skipped: skipped.length,
    })

    return {added, skipped}
  }

  async updateStateFromRemote(
    mintUrl: string,
    quoteId: string,
    state: MintQuoteState
  ): Promise<void> {
    this.logger?.info("Updating mint quote state from remote", {mintUrl, quoteId, state})
    await this.setMintQuoteState(mintUrl, quoteId, state)
  }

  private async setMintQuoteState(
    mintUrl: string,
    quoteId: string,
    state: MintQuoteState
  ): Promise<void> {
    this.logger?.debug("Setting mint quote state", {mintUrl, quoteId, state})
    await this.mintQuoteRepo.setMintQuoteState(mintUrl, quoteId, state)
    await this.eventBus.emit("mint-quote:state-changed", {mintUrl, quoteId, state})
    this.logger?.debug("Mint quote state updated", {mintUrl, quoteId, state})
  }

  /**
   * Requeue all PAID (but not yet ISSUED) quotes for processing.
   * Emits `mint-quote:added` for each PAID quote so the processor can enqueue them.
   */
  async requeuePaidMintQuotes(mintUrl?: string): Promise<{requeued: string[]}> {
    const requeued: string[] = []
    try {
      const pending = await this.mintQuoteRepo.getPendingMintQuotes()
      for (const q of pending) {
        if (mintUrl && q.mintUrl !== mintUrl) continue
        if (q.state !== "PAID") continue
        await this.eventBus.emit("mint-quote:requeue", {
          mintUrl: q.mintUrl,
          quoteId: q.quote,
        })
        requeued.push(q.quote)
      }
      this.logger?.info("Requeued PAID mint quotes", {count: requeued.length, mintUrl})
    } catch (err) {
      this.logger?.error("Failed to requeue PAID mint quotes", {mintUrl, err})
    }
    return {requeued}
  }
}
