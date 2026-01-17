import type {Token, Proof} from "@cashu/cashu-ts"
import type {
  MintService,
  WalletService,
  ProofService,
  WalletRestoreService,
  CounterService,
} from "@core/services"
import {getDecodedToken} from "@cashu/cashu-ts"
import {ProofValidationError, UnknownMintError} from "@core/models"
import {mapProofToCoreProof} from "@core/utils"
import type {Logger} from "../logging/Logger.ts"
import type {CoreEvents} from "@core/events/types.ts"
import type {EventBus} from "@core/events/EventBus.ts"

export class WalletApi {
  private mintService: MintService
  private walletService: WalletService
  private proofService: ProofService
  private walletRestoreService: WalletRestoreService
  private counterService: CounterService
  private eventBus: EventBus<CoreEvents>
  private readonly logger?: Logger

  constructor(
    mintService: MintService,
    walletService: WalletService,
    proofService: ProofService,
    walletRestoreService: WalletRestoreService,
    counterService: CounterService,
    eventBus: EventBus<CoreEvents>,
    logger?: Logger
  ) {
    this.mintService = mintService
    this.walletService = walletService
    this.proofService = proofService
    this.walletRestoreService = walletRestoreService
    this.counterService = counterService
    this.eventBus = eventBus
    this.logger = logger
  }

  async receive(token: Token | string) {
    let decoded: Token
    try {
      decoded = typeof token === "string" ? getDecodedToken(token) : token
    } catch (err) {
      this.logger?.warn("Failed to decode token for receive", {err})
      throw new ProofValidationError("Invalid token")
    }

    const {mint, proofs} = decoded

    const known = await this.mintService.isKnownMint(mint)
    if (!known) {
      throw new UnknownMintError(`Mint ${mint} is not known`)
    }

    if (!Array.isArray(proofs) || proofs.length === 0) {
      this.logger?.warn("Token contains no proofs", {mint})
      throw new ProofValidationError("Token contains no proofs")
    }

    const receiveAmount = proofs.reduce((acc, proof) => acc + proof.amount, 0)
    if (!Number.isFinite(receiveAmount) || receiveAmount <= 0) {
      this.logger?.warn("Token has invalid or non-positive amount", {mint, receiveAmount})
      throw new ProofValidationError("Token amount must be a positive integer")
    }

    this.logger?.info("Receiving token", {
      mint,
      proofs: proofs.length,
      amount: receiveAmount,
    })

    try {
      const {wallet, keysetId} =
        await this.walletService.getWalletWithActiveKeysetId(mint)

      // Get counter for deterministic secret generation
      const counterObj = await this.counterService.getCounter(mint, keysetId)
      const counter = counterObj.counter

      // Get all proofs for offline receive via deterministic secrets
      const allProofs = await this.proofService.getReadyProofs(mint)

      const newProofs = await wallet.receive(
        {mint, proofs},
        {
          counter,
          keysetId,
          proofsWeHave: allProofs,
        }
      )

      // Increment counter by number of new proofs
      await this.counterService.incrementCounter(mint, keysetId, newProofs.length)

      await this.proofService.saveProofs(
        mint,
        mapProofToCoreProof(mint, "ready", newProofs)
      )
      await this.eventBus.emit("receive:created", {mintUrl: mint, token: decoded})
      this.logger?.debug("Token received and proofs saved", {
        mint,
        newProofs: newProofs.length,
      })
    } catch (err) {
      this.logger?.error("Failed to receive token", {mint, err})
      throw err
    }
  }

  async send(mintUrl: string, amount: number, memo?: string): Promise<Token> {
    const selectedProofs = await this.proofService.selectProofsToSend(mintUrl, amount)
    const selectedAmount = selectedProofs.reduce((acc, proof) => acc + proof.amount, 0)

    // For offline operation: just select proofs without swapping
    // If exact amount match, use proofs directly
    let sendProofs = selectedProofs
    let keepProofs: Proof[] = []

    if (selectedAmount > amount) {
      // Need change - split using proofsWeHave for deterministic secrets
      const {wallet} = await this.walletService.getWalletWithActiveKeysetId(mintUrl)
      const allProofs = await this.proofService.getReadyProofs(mintUrl)
      const outputData = await this.proofService.createOutputsAndIncrementCounters(
        mintUrl,
        {
          keep: selectedAmount - amount,
          send: amount,
        }
      )

      // proofsWeHave enables offline splitting via deterministic secret generation
      const {send, keep} = await wallet.send(amount, selectedProofs, {
        outputData,
        proofsWeHave: allProofs,
      })
      sendProofs = send
      keepProofs = keep

      await this.proofService.saveProofs(
        mintUrl,
        mapProofToCoreProof(mintUrl, "ready", [...keepProofs, ...sendProofs])
      )
    }

    await this.proofService.setProofState(
      mintUrl,
      selectedProofs.map((proof) => proof.secret),
      "spent"
    )
    await this.proofService.setProofState(
      mintUrl,
      sendProofs.map((proof) => proof.secret),
      "inflight"
    )
    const token: Token = {
      mint: mintUrl,
      proofs: sendProofs,
    }
    if (memo) {
      token.memo = memo
    }
    await this.eventBus.emit("send:created", {mintUrl, token})
    return token
  }

  async getBalances(): Promise<{[mintUrl: string]: number}> {
    const proofs = await this.proofService.getAllReadyProofs()
    const balances: {[mintUrl: string]: number} = {}
    for (const proof of proofs) {
      const mintUrl = proof.mintUrl
      const balance = balances[mintUrl] || 0
      balances[mintUrl] = balance + proof.amount
    }
    return balances
  }

  // Restoration logic is delegated to WalletRestoreService

  async restore(mintUrl: string) {
    this.logger?.info("Starting restore", {mintUrl})
    const mint = await this.mintService.addMintByUrl(mintUrl)
    this.logger?.debug("Mint fetched for restore", {
      mintUrl,
      keysetCount: mint.keysets.length,
    })
    const {wallet} = await this.walletService.getWalletWithActiveKeysetId(mintUrl)
    const failedKeysetIds: {[keysetId: string]: Error} = {}
    for (const keyset of mint.keysets) {
      try {
        await this.walletRestoreService.restoreKeyset(mintUrl, wallet, keyset.id)
      } catch (error) {
        this.logger?.error("Keyset restore failed", {mintUrl, keysetId: keyset.id, error})
        failedKeysetIds[keyset.id] = error as Error
      }
    }
    if (Object.keys(failedKeysetIds).length > 0) {
      this.logger?.error("Restore completed with failures", {
        mintUrl,
        failedKeysetIds: Object.keys(failedKeysetIds),
      })
      throw new Error("Failed to restore some keysets")
    }
    this.logger?.info("Restore completed successfully", {mintUrl})
  }
}
