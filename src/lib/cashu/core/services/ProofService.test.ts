import {describe, expect, it, vi} from "vitest"
import type {Proof} from "@cashu/cashu-ts"
import {ProofValidationError} from "../models"
import {ProofService} from "./ProofService"

const mintUrl = "https://mint.example"
const keysetId = "0011223344556677"
const proof: Proof = {
  amount: 1,
  id: keysetId,
  secret: "test-secret",
  C: `02${"11".repeat(32)}`,
}

function createService() {
  const keys = {
    id: keysetId,
    unit: "sat",
    keys: Object.fromEntries(
      [1, 2, 4, 8].map((amount) => [amount, `02${"22".repeat(32)}`])
    ),
  }
  const wallet = {
    getFeesForProofs: vi.fn(() => 1),
    selectProofsToSend: vi.fn(() => ({keep: [], send: [proof]})),
  }
  const counterService = {
    reserveCounters: vi.fn(async (_mintUrl, _keysetId, count: number) => ({
      start: 7,
      end: 7 + count,
    })),
  }
  const proofRepository = {getReadyProofs: vi.fn(async () => [proof])}
  const walletService = {
    getWallet: vi.fn(async () => wallet),
    getWalletWithActiveKeysetId: vi.fn(async () => ({wallet, keysetId, keys})),
  }
  const seedService = {getSeed: vi.fn(async () => new Uint8Array(64))}
  const service = new ProofService(
    counterService as never,
    proofRepository as never,
    walletService as never,
    seedService as never
  )

  return {counterService, service, wallet}
}

describe("ProofService Cashu v3 outputs", () => {
  it("creates zero-valued deterministic blanks for melt change", async () => {
    const {counterService, service} = createService()

    const outputs = await service.createBlankOutputsAndIncrementCounter(mintUrl, 8)

    expect(outputs).toHaveLength(3)
    expect(outputs.every((output) => output.blindedMessage.amount === 0)).toBe(true)
    expect(counterService.reserveCounters).toHaveBeenCalledWith(mintUrl, keysetId, 3)
  })

  it("includes input fees when selecting proofs", async () => {
    const {service, wallet} = createService()

    await expect(service.selectProofsToSend(mintUrl, 1)).rejects.toBeInstanceOf(
      ProofValidationError
    )
    expect(wallet.selectProofsToSend).toHaveBeenCalledWith([proof], 1, true)
  })

  it.each([{sendDenominations: [4]}, {sendDenominations: []}])(
    "reserves every output when custom denominations are partial: $sendDenominations",
    async ({sendDenominations}) => {
      const {counterService, service} = createService()

      const outputs = await service.createOutputsAndIncrementCounters(mintUrl, {
        keep: 0,
        send: 7,
        sendDenominations,
      })

      expect(outputs.send).toHaveLength(3)
      expect(counterService.reserveCounters).toHaveBeenCalledWith(mintUrl, keysetId, 3)
    }
  )
})
