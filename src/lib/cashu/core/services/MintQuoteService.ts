import type {MintQuoteRepository} from "../repositories"
import type {WalletService} from "./WalletService"
import type {ProofService} from "./ProofService"
import type {MintQuoteResponse, MintQuoteState} from "@cashu/cashu-ts"
import type {CoreEvents, EventBus} from "@core/events"
import type {Logger} from "../logging/Logger.ts"
import {hydrateOutputData, persistOutputData} from "../models/OutputData"
import {mapProofToCoreProof} from "@core/utils.ts"

export class MintQuoteService {
  private readonly mintQuoteRepo: MintQuoteRepository
  private readonly walletService: WalletService
  private readonly proofService: ProofService
  private readonly eventBus: EventBus<CoreEvents>
  private readonly logger?: Logger
  private readonly quoteOperations = new Map<string, Promise<void>>()
  private readonly quoteLocks = new Map<string, Promise<unknown>>()

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
      const quote = await wallet.createMintQuoteBolt11(amount, description)
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

  getMintQuote(mintUrl: string, quoteId: string) {
    return this.mintQuoteRepo.getMintQuote(mintUrl, quoteId)
  }

  private withQuoteLock<T>(mintUrl: string, quoteId: string, work: () => Promise<T>) {
    const key = `cashu-mint:${mintUrl}:${quoteId}`
    const previous = this.quoteLocks.get(key)
    const operation = (async () => {
      await previous?.catch(() => undefined)
      if (globalThis.navigator?.locks) return navigator.locks.request(key, work)
      return work()
    })().finally(() => {
      if (this.quoteLocks.get(key) === operation) this.quoteLocks.delete(key)
    })
    this.quoteLocks.set(key, operation)
    return operation
  }

  redeemMintQuote(mintUrl: string, quoteId: string): Promise<void> {
    const key = `cashu-mint:${mintUrl}:${quoteId}`
    const active = this.quoteOperations.get(key)
    if (active) return active
    // Coordinate the processor, refresh, and other tabs before reading saved outputs.
    const operation = this.withQuoteLock(mintUrl, quoteId, () =>
      this.redeemPersistedQuote(mintUrl, quoteId)
    ).finally(() => this.quoteOperations.delete(key))
    this.quoteOperations.set(key, operation)
    return operation
  }

  private async redeemPersistedQuote(mintUrl: string, quoteId: string): Promise<void> {
    let quote = await this.mintQuoteRepo.getMintQuote(mintUrl, quoteId)
    if (!quote) throw new Error("Quote not found")
    if (quote.state === "ISSUED" && !quote.mintOutputs) return
    const wallet = await this.walletService.getWallet(mintUrl)
    const remote = await wallet.checkMintQuoteBolt11(quoteId)
    if (remote.pubkey)
      throw new Error("Locked Lightning payments are not supported by this wallet yet")
    if (remote.state === "ISSUED" && !quote.mintOutputs) {
      // Already claimed by another wallet. Do not fabricate a local balance.
      await this.setMintQuoteState(mintUrl, quoteId, "ISSUED")
      return
    }
    if (remote.state !== "PAID" && remote.state !== "ISSUED") {
      throw new Error("Lightning payment is not ready to receive")
    }
    if (remote.amount !== quote.amount || remote.unit !== quote.unit) {
      throw new Error("Mint payment details do not match")
    }
    if (!quote.mintOutputs) {
      const keyset = wallet.getKeyset()
      if (keyset.unit !== quote.unit || !keyset.isActive)
        throw new Error("No active mint keyset")
      const {keep} = await this.proofService.createOutputsAndIncrementCounters(mintUrl, {
        keep: quote.amount,
        send: 0,
      })
      quote = {...quote, mintOutputs: persistOutputData(keep), mintKeysetId: keyset.id}
      // Save recovery material before the mint can consume the paid quote.
      await this.mintQuoteRepo.addMintQuote(quote)
    }
    const outputs = hydrateOutputData(quote.mintOutputs!)
    const keysetId = quote.mintKeysetId!
    let proofs
    if (remote.state === "ISSUED") {
      const restored = await wallet.mint.restore({
        outputs: outputs.map((o) => o.blindedMessage),
      })
      const signatures = new Map(
        restored.outputs.map((o, i) => [o.B_, restored.signatures[i]])
      )
      const keys = wallet.getKeyset(keysetId).toMintKeys()
      if (!keys) throw new Error("Missing mint recovery keys")
      proofs = outputs.map((output) => {
        const signature = signatures.get(output.blindedMessage.B_)
        if (!signature) throw new Error("Mint has not returned all payment recovery data")
        return output.toProof(signature, keys)
      })
    } else {
      proofs = await wallet.mintProofsBolt11(
        quote.amount,
        remote,
        {keysetId},
        {type: "custom", data: outputs}
      )
    }
    // A previous attempt may have saved proofs but not completed the quote update.
    // Preserve existing spent/inflight states instead of crediting those proofs again.
    const existing = await this.proofService.getProofsByKeysetId(mintUrl, keysetId)
    const secrets = new Set(existing.map((proof) => proof.secret))
    await this.proofService.saveProofs(
      mintUrl,
      mapProofToCoreProof(
        mintUrl,
        "ready",
        proofs.filter((p) => !secrets.has(p.secret))
      )
    )
    await this.mintQuoteRepo.addMintQuote({
      ...quote,
      state: "ISSUED",
      mintOutputs: undefined,
      mintKeysetId: undefined,
    })
    await this.eventBus.emit("mint-quote:state-changed", {
      mintUrl,
      quoteId,
      state: "ISSUED",
    })
    await this.eventBus.emit("mint-quote:redeemed", {mintUrl, quoteId, quote})
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
        // Imports must not overwrite recovery outputs saved by another tab.
        const inserted = await this.withQuoteLock(mintUrl, quote.quote, async () => {
          if (await this.mintQuoteRepo.getMintQuote(mintUrl, quote.quote)) return false
          await this.mintQuoteRepo.addMintQuote({...quote, mintUrl})
          return true
        })
        if (!inserted) {
          this.logger?.debug("Quote already exists, skipping", {
            mintUrl,
            quoteId: quote.quote,
          })
          skipped.push(quote.quote)
          continue
        }

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
    await this.withQuoteLock(mintUrl, quoteId, async () => {
      const existing = await this.mintQuoteRepo.getMintQuote(mintUrl, quoteId)
      if (existing?.state === "ISSUED" && !existing.mintOutputs) return
      if (state === "ISSUED" && existing?.mintOutputs) {
        // A watcher can observe issuance before the response/proofs are durable.
        await this.eventBus.emit("mint-quote:requeue", {mintUrl, quoteId})
        return
      }
      await this.setMintQuoteState(mintUrl, quoteId, state)
    })
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
        if (q.state !== "PAID" && !q.mintOutputs) continue
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
