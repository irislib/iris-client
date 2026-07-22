import {describe, expect, it, vi} from "vitest"
import type {Proof} from "@cashu/cashu-ts"
import {WalletRestoreService} from "./WalletRestoreService"

const mintUrl = "https://mint.example"
const keysetId = "0011223344556677"
const proof: Proof = {
  amount: 1,
  id: keysetId,
  secret: "test-secret",
  C: `02${"11".repeat(32)}`,
}
const newProof: Proof = {...proof, amount: 2, secret: "new-secret"}
const pendingProof: Proof = {...proof, amount: 4, secret: "pending-secret"}
const abandonedProof: Proof = {...proof, amount: 8, secret: "abandoned-secret"}

describe("WalletRestoreService", () => {
  it("advances past a restored signature at counter zero", async () => {
    const proofService = {
      getProofsByKeysetId: vi.fn(async () => []),
      setProofState: vi.fn(async () => {}),
      saveProofs: vi.fn(async () => {}),
    }
    const counterService = {advanceCounterToAtLeast: vi.fn(async () => {})}
    const wallet = {
      batchRestore: vi.fn(async () => ({
        proofs: [proof],
        lastCounterWithSignature: 0,
      })),
      checkProofsStates: vi.fn(async () => [{state: "UNSPENT"}]),
    }
    const service = new WalletRestoreService(
      proofService as never,
      counterService as never
    )

    await service.restoreKeyset(mintUrl, wallet as never, keysetId)

    expect(counterService.advanceCounterToAtLeast).toHaveBeenCalledWith(
      mintUrl,
      keysetId,
      1
    )
  })

  it("reconciles existing proofs and only inserts newly restored secrets", async () => {
    const proofService = {
      getProofsByKeysetId: vi.fn(async () => [
        {...proof, mintUrl, state: "ready"},
        {...pendingProof, mintUrl, state: "inflight"},
        {...abandonedProof, mintUrl, state: "inflight"},
      ]),
      setProofState: vi.fn(async () => {}),
      saveProofs: vi.fn(async () => {}),
    }
    const counterService = {advanceCounterToAtLeast: vi.fn(async () => {})}
    const wallet = {
      batchRestore: vi.fn(async () => ({
        proofs: [proof, newProof, pendingProof, abandonedProof],
        lastCounterWithSignature: 3,
      })),
      checkProofsStates: vi.fn(async () => [
        {state: "SPENT"},
        {state: "UNSPENT"},
        {state: "PENDING"},
        {state: "UNSPENT"},
      ]),
    }
    const service = new WalletRestoreService(
      proofService as never,
      counterService as never
    )

    await service.restoreKeyset(mintUrl, wallet as never, keysetId)

    expect(proofService.setProofState).toHaveBeenCalledWith(
      mintUrl,
      [proof.secret],
      "spent"
    )
    expect(proofService.setProofState).toHaveBeenCalledWith(
      mintUrl,
      [pendingProof.secret],
      "inflight"
    )
    expect(proofService.setProofState).toHaveBeenCalledWith(
      mintUrl,
      [abandonedProof.secret],
      "ready"
    )
    expect(proofService.saveProofs).toHaveBeenCalledWith(mintUrl, [
      {...newProof, mintUrl, state: "ready"},
    ])
  })
})
