import type {MeltQuoteResponse, Proof, Wallet} from "@cashu/cashu-ts"
import type {Logger} from "../logging/Logger"
import type {ProofService} from "./ProofService"
import type {WalletService} from "./WalletService"
import type {EventBus} from "../events/EventBus"
import type {CoreEvents} from "../events/types"
import type {MeltQuoteRepository} from "../repositories"
import {
  hydrateMeltOutputData,
  hydrateMeltPreview,
  persistMeltPreview,
  type MeltQuote,
  type PersistedMeltPreview,
} from "../models/MeltQuote"
import {createFeeAwareOutputPlan, mapProofToCoreProof} from "@core/utils"

export interface ReconciledMeltQuote {
  mintUrl: string
  quoteId: string
}

export interface ReconcilePendingMeltsResult {
  paid: ReconciledMeltQuote[]
  unpaid: ReconciledMeltQuote[]
  pending: ReconciledMeltQuote[]
  failed: ReconciledMeltQuote[]
}

export class MeltQuoteService {
  private readonly proofService: ProofService
  private readonly walletService: WalletService
  private readonly meltQuoteRepo: MeltQuoteRepository
  private readonly logger?: Logger
  private readonly eventBus: EventBus<CoreEvents>
  private readonly quoteOperations = new Map<string, Promise<MeltQuoteResponse>>()

  constructor(
    proofService: ProofService,
    walletService: WalletService,
    meltQuoteRepo: MeltQuoteRepository,
    eventBus: EventBus<CoreEvents>,
    logger?: Logger
  ) {
    this.proofService = proofService
    this.walletService = walletService
    this.meltQuoteRepo = meltQuoteRepo
    this.eventBus = eventBus
    this.logger = logger
  }

  async createMeltQuote(mintUrl: string, invoice: string): Promise<MeltQuoteResponse> {
    if (!mintUrl || !mintUrl.trim()) {
      this.logger?.warn("Invalid parameter: mintUrl is required for createMeltQuote")
      throw new Error("mintUrl is required")
    }
    if (!invoice || !invoice.trim()) {
      this.logger?.warn("Invalid parameter: invoice is required for createMeltQuote", {
        mintUrl,
      })
      throw new Error("invoice is required")
    }

    this.logger?.info("Creating melt quote", {mintUrl})
    try {
      const {wallet} = await this.walletService.getWalletWithActiveKeysetId(mintUrl)
      const quote = await wallet.createMeltQuoteBolt11(invoice)
      await this.meltQuoteRepo.saveMeltQuote({...quote, mintUrl, meltPreview: null})
      await this.eventBus.emit("melt-quote:created", {
        mintUrl,
        quoteId: quote.quote,
        quote,
      })
      return quote
    } catch (err) {
      this.logger?.error("Failed to create melt quote", {mintUrl, err})
      throw err
    }
  }

  async payMeltQuote(mintUrl: string, quoteId: string): Promise<MeltQuoteResponse> {
    if (!mintUrl || !mintUrl.trim()) {
      this.logger?.warn("Invalid parameter: mintUrl is required for payMeltQuote")
      throw new Error("mintUrl is required")
    }
    if (!quoteId || !quoteId.trim()) {
      this.logger?.warn("Invalid parameter: quoteId is required for payMeltQuote", {
        mintUrl,
      })
      throw new Error("quoteId is required")
    }

    return this.runQuoteOperation(mintUrl, quoteId, async () => {
      this.logger?.info("Paying melt quote", {mintUrl, quoteId})
      try {
        const quote = await this.meltQuoteRepo.getMeltQuote(mintUrl, quoteId)
        if (!quote) {
          this.logger?.warn("Melt quote not found", {mintUrl, quoteId})
          throw new Error("Quote not found")
        }
        if (quote.state === "PAID" && !quote.meltPreview) return quote
        if (quote.state === "PENDING" || quote.meltPreview) {
          const wallet = await this.walletService.getWallet(mintUrl)
          return this.reconcileMeltQuote(wallet, quote)
        }

        const amountWithFee = quote.amount + quote.fee_reserve
        const {wallet, keysetId, keys} =
          await this.walletService.getWalletWithActiveKeysetId(mintUrl)
        const sendPlan = createFeeAwareOutputPlan(amountWithFee, keys, wallet)
        const sendAmount = sendPlan.amount
        const selectedProofs = await this.proofService.selectProofsToSend(
          mintUrl,
          sendAmount
        )
        const selectedAmount = selectedProofs.reduce(
          (sum, proof) => sum + proof.amount,
          0
        )
        const swapFees = wallet.getFeesForProofs(selectedProofs)
        if (selectedAmount < sendAmount + swapFees) {
          this.logger?.warn("Insufficient proofs to cover melt amount with fee", {
            mintUrl,
            quoteId,
            required: sendAmount + swapFees,
            available: selectedAmount,
          })
          throw new Error("Insufficient proofs to pay melt quote")
        }

        const outputData = await this.proofService.createOutputsAndIncrementCounters(
          mintUrl,
          {
            keep: selectedAmount - sendAmount - swapFees,
            send: sendAmount,
            sendDenominations: sendPlan.denominations,
          }
        )
        const {send, keep} = await wallet.send(sendAmount, selectedProofs, undefined, {
          keep: {type: "custom", data: outputData.keep},
          send: {type: "custom", data: outputData.send},
        })

        await this.proofService.saveProofs(
          mintUrl,
          mapProofToCoreProof(mintUrl, "ready", [...keep, ...send])
        )
        await this.proofService.setProofState(
          mintUrl,
          selectedProofs.map((proof) => proof.secret),
          "spent"
        )
        const changeOutputs =
          await this.proofService.createBlankOutputsAndIncrementCounter(
            mintUrl,
            send.reduce((sum, proof) => sum + proof.amount, 0) - quote.amount
          )
        const preview = await wallet.prepareMelt(
          "bolt11",
          quote,
          send,
          {keysetId},
          {type: "custom", data: changeOutputs}
        )
        const persistedPreview = persistMeltPreview(preview)
        const preparedQuote: MeltQuote = {
          ...quote,
          state: "PENDING",
          meltPreview: persistedPreview,
        }

        // This write is the recovery point and must complete before the melt request starts.
        await this.persistQuote(preparedQuote, quote.state)
        await this.proofService.setProofState(
          mintUrl,
          persistedPreview.inputs.map((proof) => proof.secret),
          "inflight"
        )
        const meltResponse = await wallet.completeMelt(preview)
        return this.applyMeltResult(
          preparedQuote,
          meltResponse.quote,
          persistedPreview,
          meltResponse.change
        )
      } catch (err) {
        this.logger?.error("Failed to pay melt quote", {mintUrl, quoteId, err})
        throw err
      }
    })
  }

  async reconcilePendingMelts(): Promise<ReconcilePendingMeltsResult> {
    const result: ReconcilePendingMeltsResult = {
      paid: [],
      unpaid: [],
      pending: [],
      failed: [],
    }
    const quotes = await this.meltQuoteRepo.getPendingMeltQuotes()
    const byMint = new Map<string, MeltQuote[]>()
    for (const quote of quotes) {
      const mintQuotes = byMint.get(quote.mintUrl) ?? []
      mintQuotes.push(quote)
      byMint.set(quote.mintUrl, mintQuotes)
    }

    await Promise.all(
      Array.from(byMint, async ([mintUrl, mintQuotes]) => {
        let wallet: Wallet
        try {
          wallet = await this.walletService.getWallet(mintUrl)
        } catch (err) {
          this.logger?.warn("Could not load mint wallet for melt recovery", {
            mintUrl,
            err,
          })
          result.failed.push(
            ...mintQuotes.map((quote) => ({mintUrl, quoteId: quote.quote}))
          )
          return
        }

        for (const quote of mintQuotes) {
          const entry = {mintUrl, quoteId: quote.quote}
          try {
            const reconciled = await this.runQuoteOperation(
              mintUrl,
              quote.quote,
              async () => {
                const current =
                  (await this.meltQuoteRepo.getMeltQuote(mintUrl, quote.quote)) ?? quote
                return this.reconcileMeltQuote(wallet, current)
              }
            )
            if (reconciled.state === "PAID") result.paid.push(entry)
            else if (reconciled.state === "UNPAID") result.unpaid.push(entry)
            else result.pending.push(entry)
          } catch (err) {
            this.logger?.warn("Could not reconcile pending melt quote", {
              ...entry,
              err,
            })
            result.failed.push(entry)
          }
        }
      })
    )
    return result
  }

  private async reconcileMeltQuote(
    wallet: Wallet,
    quote: MeltQuote
  ): Promise<MeltQuoteResponse> {
    const persistedPreview = quote.meltPreview ?? null
    if (persistedPreview) {
      await this.proofService.setProofState(
        quote.mintUrl,
        persistedPreview.inputs.map((proof) => proof.secret),
        "inflight"
      )
    }
    const checked = await wallet.checkMeltQuoteBolt11(quote)
    if (!persistedPreview || checked.state === "UNPAID") {
      return this.applyMeltResult(quote, checked, persistedPreview, [])
    }

    const preview = hydrateMeltPreview(persistedPreview, checked)
    try {
      const replayed = await wallet.completeMelt(preview)
      return this.applyMeltResult(
        quote,
        replayed.quote,
        persistedPreview,
        replayed.change
      )
    } catch (replayError) {
      // A NUT-19 replay can be rejected after the original request already paid.
      // Re-check first so transport failures never make us guess about proof state.
      const latest =
        checked.state === "PAID"
          ? checked
          : await wallet.checkMeltQuoteBolt11(quote).catch(() => null)
      if (!latest || latest.state === "PENDING") throw replayError
      if (latest.state === "UNPAID") {
        return this.applyMeltResult(quote, latest, persistedPreview, [])
      }

      const change = await this.restoreMeltChange(wallet, persistedPreview)
      return this.applyMeltResult(quote, latest, persistedPreview, change)
    }
  }

  private async restoreMeltChange(
    wallet: Wallet,
    persistedPreview: PersistedMeltPreview
  ): Promise<Proof[]> {
    if (persistedPreview.outputData.length === 0) return []
    const outputData = hydrateMeltOutputData(persistedPreview)
    const restored = await wallet.mint.restore({
      outputs: outputData.map((output) => output.blindedMessage),
    })
    const signaturesByOutput = new Map(
      restored.outputs.flatMap((output, index) => {
        const signature = restored.signatures[index]
        return signature ? ([[output.B_, signature]] as const) : []
      })
    )
    const keys = wallet.getKeyset(persistedPreview.keysetId).toMintKeys()
    if (!keys) throw new Error(`Missing melt keyset ${persistedPreview.keysetId}`)

    return outputData.flatMap((output) => {
      const signature = signaturesByOutput.get(output.blindedMessage.B_)
      if (!signature) return []
      output.blindedMessage.amount = signature.amount
      return [output.toProof(signature, keys)]
    })
  }

  private async applyMeltResult(
    previous: MeltQuote,
    response: MeltQuoteResponse,
    persistedPreview: PersistedMeltPreview | null,
    change: Proof[]
  ): Promise<MeltQuoteResponse> {
    const {mintUrl} = previous
    if (response.state === "PAID") {
      await this.proofService.setProofState(
        mintUrl,
        (persistedPreview?.inputs ?? []).map((proof) => proof.secret),
        "spent"
      )
      await this.saveNewChangeProofs(mintUrl, change)
    } else if (response.state === "UNPAID") {
      await this.proofService.setProofState(
        mintUrl,
        (persistedPreview?.inputs ?? []).map((proof) => proof.secret),
        "ready"
      )
    }

    const resolved = response.state !== "PENDING"
    const updated: MeltQuote = {
      ...previous,
      ...response,
      mintUrl,
      meltPreview: resolved ? null : persistedPreview,
    }
    await this.persistQuote(updated, previous.state)
    if (updated.state === "PAID" && previous.state !== "PAID") {
      await this.eventBus.emit("melt-quote:paid", {
        mintUrl,
        quoteId: updated.quote,
        quote: updated,
      })
    }
    return updated
  }

  private async saveNewChangeProofs(mintUrl: string, change: Proof[]): Promise<void> {
    if (change.length === 0) return
    const existingSecrets = new Set<string>()
    for (const keysetId of new Set(change.map((proof) => proof.id))) {
      const existing = await this.proofService.getProofsByKeysetId(mintUrl, keysetId)
      for (const proof of existing) existingSecrets.add(proof.secret)
    }
    const newChange = change.filter((proof) => !existingSecrets.has(proof.secret))
    if (newChange.length === 0) return
    await this.proofService.saveProofs(
      mintUrl,
      mapProofToCoreProof(mintUrl, "ready", newChange)
    )
  }

  private async persistQuote(quote: MeltQuote, previousState: MeltQuote["state"]) {
    await this.meltQuoteRepo.saveMeltQuote(quote)
    if (quote.state !== previousState) {
      await this.eventBus.emit("melt-quote:state-changed", {
        mintUrl: quote.mintUrl,
        quoteId: quote.quote,
        state: quote.state,
      })
    }
  }

  private runQuoteOperation(
    mintUrl: string,
    quoteId: string,
    operation: () => Promise<MeltQuoteResponse>
  ): Promise<MeltQuoteResponse> {
    const key = `${mintUrl}\u0000${quoteId}`
    const active = this.quoteOperations.get(key)
    if (active) return active
    const next = operation().finally(() => {
      if (this.quoteOperations.get(key) === next) this.quoteOperations.delete(key)
    })
    this.quoteOperations.set(key, next)
    return next
  }
}
