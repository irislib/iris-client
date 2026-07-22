import {OutputData, splitAmount, type Proof} from "@cashu/cashu-ts"
import type {CoreProof} from "../types"
import type {CounterService} from "./CounterService"
import type {ProofRepository} from "../repositories"
import {EventBus} from "../events/EventBus"
import type {CoreEvents} from "../events/types"
import {ProofOperationError, ProofValidationError} from "../models/Error"
import {WalletService} from "./WalletService"
import type {Logger} from "../logging/Logger.ts"
import type {SeedService} from "./SeedService.ts"

export class ProofService {
  private readonly counterService: CounterService
  private readonly proofRepository: ProofRepository
  private readonly eventBus?: EventBus<CoreEvents>
  private readonly walletService: WalletService
  private readonly seedService: SeedService
  private readonly logger?: Logger
  constructor(
    counterService: CounterService,
    proofRepository: ProofRepository,
    walletService: WalletService,
    seedService: SeedService,
    logger?: Logger,
    eventBus?: EventBus<CoreEvents>
  ) {
    this.counterService = counterService
    this.walletService = walletService
    this.proofRepository = proofRepository
    this.seedService = seedService
    this.logger = logger
    this.eventBus = eventBus
  }

  async createOutputsAndIncrementCounters(
    mintUrl: string,
    amount: {
      keep: number
      send: number
      keepDenominations?: number[]
      sendDenominations?: number[]
    }
  ): Promise<{keep: OutputData[]; send: OutputData[]}> {
    if (!mintUrl || mintUrl.trim().length === 0) {
      throw new ProofValidationError("mintUrl is required")
    }
    if (
      !Number.isFinite(amount.keep) ||
      !Number.isFinite(amount.send) ||
      amount.keep < 0 ||
      amount.send < 0
    ) {
      return {keep: [], send: []}
    }
    const {keys} = await this.walletService.getWalletWithActiveKeysetId(mintUrl)
    const seed = await this.seedService.getSeed()
    const keepCount =
      amount.keep > 0
        ? splitAmount(amount.keep, keys.keys, amount.keepDenominations).length
        : 0
    const sendCount =
      amount.send > 0
        ? splitAmount(amount.send, keys.keys, amount.sendDenominations).length
        : 0
    const data: {keep: OutputData[]; send: OutputData[]} = {keep: [], send: []}
    if (keepCount + sendCount === 0) return data
    const {start} = await this.counterService.reserveCounters(
      mintUrl,
      keys.id,
      keepCount + sendCount
    )
    if (amount.keep > 0) {
      data.keep = OutputData.createDeterministicData(
        amount.keep,
        seed,
        start,
        keys,
        amount.keepDenominations
      )
    }
    if (amount.send > 0) {
      data.send = OutputData.createDeterministicData(
        amount.send,
        seed,
        start + keepCount,
        keys,
        amount.sendDenominations
      )
    }
    this.logger?.debug("Deterministic outputs created", {
      mintUrl,
      keysetId: keys.id,
      amount,
      outputs: data.keep.length + data.send.length,
    })
    return data
  }

  async createBlankOutputsAndIncrementCounter(
    mintUrl: string,
    maxChange: number
  ): Promise<OutputData[]> {
    if (!Number.isFinite(maxChange) || maxChange <= 0) return []

    const count = Math.ceil(Math.log2(maxChange)) || 1
    const {keysetId} = await this.walletService.getWalletWithActiveKeysetId(mintUrl)
    const seed = await this.seedService.getSeed()
    const {start} = await this.counterService.reserveCounters(mintUrl, keysetId, count)
    const outputs = Array.from({length: count}, (_, index) =>
      OutputData.createSingleDeterministicData(0, seed, start + index, keysetId)
    )
    return outputs
  }

  async saveProofs(mintUrl: string, proofs: CoreProof[]): Promise<void> {
    if (!mintUrl || mintUrl.trim().length === 0) {
      throw new ProofValidationError("mintUrl is required")
    }
    if (!Array.isArray(proofs) || proofs.length === 0) return

    const groupedByKeyset = this.groupProofsByKeysetId(proofs)

    const entries = Array.from(groupedByKeyset.entries())
    const tasks = entries.map(([keysetId, group]) =>
      (async () => {
        await this.proofRepository.saveProofs(mintUrl, group)
        await this.eventBus?.emit("proofs:saved", {
          mintUrl,
          keysetId,
          proofs: group,
        })
        this.logger?.info("Proofs saved", {mintUrl, keysetId, count: group.length})
      })().catch((error) => {
        // Enrich the rejection with keyset context so we can log precise details later
        throw {keysetId, error}
      })
    )
    const results = await Promise.allSettled(tasks)

    const failed = results.filter(
      (r): r is PromiseRejectedResult => r.status === "rejected"
    )
    if (failed.length > 0) {
      // Log each failure with its original error for maximum visibility
      for (const fr of failed) {
        const {keysetId, error} = fr.reason as {keysetId?: string; error?: unknown}
        this.logger?.error("Failed to persist proofs for keyset", {
          mintUrl,
          keysetId,
          error,
        })
      }
      const details = failed.map(
        (fr) => fr.reason as {keysetId?: string; error?: unknown}
      )
      const failedKeysets = details
        .map((d) => d.keysetId)
        .filter((id): id is string => Boolean(id))
      const aggregate = new AggregateError(
        details.map((d) =>
          d?.error instanceof Error ? d.error : new Error(String(d?.error))
        ),
        `Failed to persist proofs for ${failed.length} keyset group(s)`
      )
      const message =
        failedKeysets.length > 0
          ? `Failed to persist proofs for ${failed.length} keyset group(s) [${failedKeysets.join(
              ", "
            )}]`
          : `Failed to persist proofs for ${failed.length} keyset group(s)`
      throw new ProofOperationError(mintUrl, message, undefined, aggregate)
    }
  }

  async getReadyProofs(mintUrl: string): Promise<CoreProof[]> {
    return this.proofRepository.getReadyProofs(mintUrl)
  }

  async getAllReadyProofs(): Promise<CoreProof[]> {
    return this.proofRepository.getAllReadyProofs()
  }

  async setProofState(
    mintUrl: string,
    secrets: string[],
    state: "inflight" | "ready" | "spent"
  ): Promise<void> {
    if (!mintUrl || mintUrl.trim().length === 0) {
      throw new ProofValidationError("mintUrl is required")
    }
    if (!secrets || secrets.length === 0) return
    await this.proofRepository.setProofState(mintUrl, secrets, state)
    await this.eventBus?.emit("proofs:state-changed", {
      mintUrl,
      secrets,
      state,
    })
    this.logger?.debug("Proof state updated", {mintUrl, count: secrets.length, state})
  }

  async deleteProofs(mintUrl: string, secrets: string[]): Promise<void> {
    if (!mintUrl || mintUrl.trim().length === 0) {
      throw new ProofValidationError("mintUrl is required")
    }
    if (!secrets || secrets.length === 0) return
    await this.proofRepository.deleteProofs(mintUrl, secrets)
    await this.eventBus?.emit("proofs:deleted", {mintUrl, secrets})
    this.logger?.info("Proofs deleted", {mintUrl, count: secrets.length})
  }

  async wipeProofsByKeysetId(mintUrl: string, keysetId: string): Promise<void> {
    if (!mintUrl || mintUrl.trim().length === 0) {
      throw new ProofValidationError("mintUrl is required")
    }
    if (!keysetId || keysetId.trim().length === 0) {
      throw new ProofValidationError("keysetId is required")
    }
    await this.proofRepository.wipeProofsByKeysetId(mintUrl, keysetId)
    await this.eventBus?.emit("proofs:wiped", {mintUrl, keysetId})
    this.logger?.info("Proofs wiped by keyset", {mintUrl, keysetId})
  }

  async selectProofsToSend(mintUrl: string, amount: number): Promise<Proof[]> {
    const proofs = await this.getReadyProofs(mintUrl)
    const totalAmount = proofs.reduce((acc, proof) => acc + proof.amount, 0)
    if (totalAmount < amount) {
      throw new ProofValidationError("Not enough proofs to send")
    }
    const cashuWallet = await this.walletService.getWallet(mintUrl)
    const selectedProofs = cashuWallet.selectProofsToSend(proofs, amount, true)
    const selectedAmount = selectedProofs.send.reduce(
      (sum, proof) => sum + proof.amount,
      0
    )
    if (selectedAmount < amount + cashuWallet.getFeesForProofs(selectedProofs.send)) {
      throw new ProofValidationError("Not enough proofs to send")
    }
    this.logger?.debug("Selected proofs to send", {
      mintUrl,
      amount,
      selectedProofs,
      count: selectedProofs.send.length,
    })
    return selectedProofs.send
  }
  private groupProofsByKeysetId(proofs: CoreProof[]): Map<string, CoreProof[]> {
    const map = new Map<string, CoreProof[]>()
    for (const proof of proofs) {
      if (!proof.secret) throw new ProofValidationError("Proof missing secret")
      const keysetId = proof.id
      if (!keysetId || keysetId.trim().length === 0) {
        throw new ProofValidationError("Proof missing keyset id")
      }
      const existing = map.get(keysetId)
      if (existing) {
        existing.push(proof)
      } else {
        map.set(keysetId, [proof])
      }
    }
    return map
  }

  async getProofsByKeysetId(mintUrl: string, keysetId: string): Promise<CoreProof[]> {
    return this.proofRepository.getProofsByKeysetId(mintUrl, keysetId)
  }

  async hasProofsForKeyset(mintUrl: string, keysetId: string): Promise<boolean> {
    if (!mintUrl || mintUrl.trim().length === 0) {
      throw new ProofValidationError("mintUrl is required")
    }
    if (!keysetId || keysetId.trim().length === 0) {
      throw new ProofValidationError("keysetId is required")
    }

    const proofs = await this.proofRepository.getProofsByKeysetId(mintUrl, keysetId)
    const hasProofs = proofs.length > 0

    this.logger?.debug("Checked proofs for keyset", {
      mintUrl,
      keysetId,
      hasProofs,
      totalProofs: proofs.length,
    })

    return hasProofs
  }
}
