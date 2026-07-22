import type {Proof, Wallet} from "@cashu/cashu-ts"
import {mapProofToCoreProof} from "@core/utils"
import type {ProofService} from "./ProofService"
import type {CounterService} from "./CounterService"
import type {Logger} from "../logging/Logger.ts"

export class WalletRestoreService {
  private readonly proofService: ProofService
  private readonly counterService: CounterService
  private readonly logger?: Logger

  // Defaults for batch restore behavior
  private readonly restoreBatchSize = 300
  private readonly restoreGapLimit = 100
  private readonly restoreStartCounter = 0

  constructor(
    proofService: ProofService,
    counterService: CounterService,
    logger?: Logger
  ) {
    this.proofService = proofService
    this.counterService = counterService
    this.logger = logger
  }

  /**
   * Restore and persist proofs for a single keyset.
   * Enforces the invariant: restored proofs must be >= previously stored proofs.
   * Throws on any validation or persistence error. No transactions are used here.
   */
  async restoreKeyset(mintUrl: string, wallet: Wallet, keysetId: string): Promise<void> {
    this.logger?.debug("Restoring keyset", {mintUrl, keysetId})
    const oldProofs = await this.proofService.getProofsByKeysetId(mintUrl, keysetId)
    this.logger?.debug("Existing proofs before restore", {
      mintUrl,
      keysetId,
      count: oldProofs.length,
    })

    const {proofs, lastCounterWithSignature} = await wallet.batchRestore(
      this.restoreGapLimit,
      this.restoreBatchSize,
      this.restoreStartCounter,
      keysetId
    )

    if (proofs.length === 0) {
      this.logger?.warn("No proofs to restore", {mintUrl, keysetId})
      return
    }

    this.logger?.info("Batch restore result", {
      mintUrl,
      keysetId,
      restored: proofs.length,
      lastCounterWithSignature,
    })

    // Hard requirement: restored proofs must be >= previously stored proofs
    if (oldProofs.length > proofs.length) {
      this.logger?.warn("Restored fewer proofs than previously stored", {
        mintUrl,
        keysetId,
        previous: oldProofs.length,
        restored: proofs.length,
      })
      throw new Error("Restored less proofs than expected.")
    }

    const states = await wallet.checkProofsStates(proofs)
    if (!Array.isArray(states) || states.length !== proofs.length) {
      this.logger?.error("Malformed state check", {
        mintUrl,
        keysetId,
        statesLength: (states as unknown as {length?: number})?.length,
        proofsLength: proofs.length,
      })
      throw new Error("Malformed state check")
    }

    const checkedProofs: {spent: Proof[]; pending: Proof[]; ready: Proof[]} = {
      spent: [],
      pending: [],
      ready: [],
    }
    for (const [index, state] of states.entries()) {
      if (!proofs[index]) {
        this.logger?.error("Proof not found", {mintUrl, keysetId, index})
        throw new Error("Proof not found")
      }
      if (state.state === "SPENT") {
        checkedProofs.spent.push(proofs[index])
      } else if (state.state === "PENDING") {
        checkedProofs.pending.push(proofs[index])
      } else if (state.state === "UNSPENT") {
        checkedProofs.ready.push(proofs[index])
      } else {
        throw new Error(`Unknown proof state: ${String(state.state)}`)
      }
    }

    this.logger?.debug("Checked proof states", {
      mintUrl,
      keysetId,
      ready: checkedProofs.ready.length,
      pending: checkedProofs.pending.length,
      spent: checkedProofs.spent.length,
    })

    const oldSecrets = new Set(oldProofs.map(({secret}) => secret))
    const restoredSecrets = new Set(proofs.map(({secret}) => secret))
    if (oldProofs.some(({secret}) => !restoredSecrets.has(secret))) {
      throw new Error("Restore did not reproduce all existing proofs")
    }

    const newCounter =
      lastCounterWithSignature !== undefined ? lastCounterWithSignature + 1 : 0

    await this.counterService.advanceCounterToAtLeast(mintUrl, keysetId, newCounter)
    this.logger?.debug("Requested counter advancement for keyset", {
      mintUrl,
      keysetId,
      counter: newCounter,
    })

    const existingSpent = checkedProofs.spent
      .filter(({secret}) => oldSecrets.has(secret))
      .map(({secret}) => secret)
    const existingPending = checkedProofs.pending
      .filter(({secret}) => oldSecrets.has(secret))
      .map(({secret}) => secret)
    const existingReady = checkedProofs.ready
      .filter(({secret}) => oldSecrets.has(secret))
      .map(({secret}) => secret)
    await this.proofService.setProofState(mintUrl, existingSpent, "spent")
    await this.proofService.setProofState(mintUrl, existingPending, "inflight")
    await this.proofService.setProofState(mintUrl, existingReady, "ready")

    const newReady = checkedProofs.ready.filter(({secret}) => !oldSecrets.has(secret))
    const newPending = checkedProofs.pending.filter(({secret}) => !oldSecrets.has(secret))
    await this.proofService.saveProofs(mintUrl, [
      ...mapProofToCoreProof(mintUrl, "ready", newReady),
      ...mapProofToCoreProof(mintUrl, "inflight", newPending),
    ])
    this.logger?.info("Saved restored proofs for keyset", {
      mintUrl,
      keysetId,
      total: checkedProofs.ready.length + checkedProofs.spent.length,
    })
  }
}
