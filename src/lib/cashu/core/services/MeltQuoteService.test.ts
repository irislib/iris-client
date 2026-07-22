import {OutputData, type MeltQuoteResponse, type Proof} from "@cashu/cashu-ts"
import {afterEach, describe, expect, it, vi} from "vitest"
import type {MeltQuote, PersistedMeltPreview} from "../models/MeltQuote"
import type {CoreProof} from "../types"
import {MeltQuoteService} from "./MeltQuoteService"

const mintUrl = "https://mint.example"
const quoteId = "melt-quote"
const keysetId = "0011223344556677"
const keys = {
  id: keysetId,
  unit: "sat",
  keys: Object.fromEntries(
    [1, 2, 4, 8].map((amount) => [amount, `02${"22".repeat(32)}`])
  ),
}

function proof(secret: string, amount: number): Proof {
  return {amount, id: keysetId, secret, C: `02${"11".repeat(32)}`}
}

function outputData(B_: string, secret: number[]) {
  return {
    blindedMessage: {amount: 0, B_, id: keysetId},
    blindingFactor: 7n,
    secret: Uint8Array.from(secret),
    toProof: vi.fn(),
  }
}

const selectedProof = proof("selected", 8)
const keepProof = proof("keep", 1)
const sendProof = proof("send", 5)
const changeProof = proof("change", 1)
const quote: MeltQuote = {
  mintUrl,
  quote: quoteId,
  request: "lnbc1invoice",
  amount: 4,
  fee_reserve: 1,
  unit: "sat",
  state: "UNPAID",
  expiry: 1_800_000_000,
  payment_preimage: null,
  meltPreview: null,
}
const persistedPreview: PersistedMeltPreview = {
  method: "bolt11",
  inputs: [sendProof],
  keysetId,
  outputData: [
    {
      blindedMessage: {
        amount: 0,
        B_: `02${"33".repeat(32)}`,
        id: keysetId,
      },
      blindingFactor: "7",
      secret: "0102",
    },
  ],
}

function createService(
  responseState: MeltQuoteResponse["state"],
  {
    inputFeePpk = 0,
    keep = [keepProof],
    send = [sendProof],
  }: {inputFeePpk?: number; keep?: Proof[]; send?: Proof[]} = {}
) {
  let stored: MeltQuote = {...quote}
  const preparedOutput = outputData(`02${"33".repeat(32)}`, [1, 2])
  const updatedQuote: MeltQuoteResponse = {
    ...quote,
    state: responseState,
    payment_preimage: responseState === "PAID" ? "preimage" : null,
  }
  const wallet = {
    getFeesForProofs: vi.fn(() => 0),
    getFeesForKeyset: vi.fn((outputCount: number) =>
      Math.ceil((outputCount * inputFeePpk) / 1000)
    ),
    send: vi.fn(async () => ({keep, send})),
    prepareMelt: vi.fn(
      async (
        method: string,
        meltQuote: MeltQuoteResponse,
        inputs: Proof[],
        config: {keysetId: string},
        outputType: {data: (typeof preparedOutput)[]}
      ) => ({
        method,
        quote: meltQuote,
        inputs,
        keysetId: config.keysetId,
        outputData: outputType.data,
      })
    ),
    completeMelt: vi.fn(async () => {
      expect(stored).toMatchObject({state: "PENDING"})
      expect(stored.meltPreview).toMatchObject({
        keysetId,
        inputs: send,
        outputData: [
          {
            blindingFactor: "7",
            secret: "0102",
          },
        ],
      })
      return {
        quote: updatedQuote,
        change: responseState === "PAID" ? [changeProof] : [],
      }
    }),
    checkMeltQuoteBolt11: vi.fn(async () => updatedQuote),
    mint: {restore: vi.fn()},
    getKeyset: vi.fn(() => ({toMintKeys: () => keys})),
  }
  const proofService = {
    selectProofsToSend: vi.fn(async () => [selectedProof]),
    createOutputsAndIncrementCounters: vi.fn(async () => ({keep: [], send: []})),
    createBlankOutputsAndIncrementCounter: vi.fn(async () => [preparedOutput]),
    saveProofs: vi.fn(async () => {}),
    setProofState: vi.fn(async () => {}),
    getProofsByKeysetId: vi.fn(async (): Promise<CoreProof[]> => []),
  }
  const walletService = {
    getWalletWithActiveKeysetId: vi.fn(async () => ({wallet, keysetId, keys})),
    getWallet: vi.fn(async () => wallet),
  }
  const meltQuoteRepo = {
    getMeltQuote: vi.fn(async () => stored),
    saveMeltQuote: vi.fn(async (next: MeltQuote) => {
      stored = next
    }),
    getPendingMeltQuotes: vi.fn(async () =>
      stored.state === "PENDING" || stored.meltPreview ? [stored] : []
    ),
  }
  const eventBus = {emit: vi.fn(async () => {})}
  const service = new MeltQuoteService(
    proofService as never,
    walletService as never,
    meltQuoteRepo as never,
    eventBus as never
  )

  return {
    eventBus,
    getStored: () => stored,
    meltQuoteRepo,
    proofService,
    service,
    setStored: (next: MeltQuote) => {
      stored = next
    },
    updatedQuote,
    wallet,
    walletService,
  }
}

afterEach(() => vi.restoreAllMocks())

describe("MeltQuoteService.payMeltQuote", () => {
  it("persists a JSON-safe preview before completing and atomically resolves PAID", async () => {
    const {eventBus, getStored, proofService, service, wallet} = createService("PAID")

    const result = await service.payMeltQuote(mintUrl, quoteId)

    expect(wallet.prepareMelt).toHaveBeenCalledOnce()
    expect(wallet.completeMelt).toHaveBeenCalledOnce()
    expect(proofService.setProofState).toHaveBeenLastCalledWith(
      mintUrl,
      [sendProof.secret],
      "spent"
    )
    expect(proofService.saveProofs).toHaveBeenLastCalledWith(mintUrl, [
      {...changeProof, mintUrl, state: "ready"},
    ])
    expect(getStored()).toMatchObject({
      state: "PAID",
      payment_preimage: "preimage",
      meltPreview: null,
    })
    expect(eventBus.emit).toHaveBeenCalledWith("melt-quote:paid", {
      mintUrl,
      quoteId,
      quote: expect.objectContaining({state: "PAID", payment_preimage: "preimage"}),
    })
    expect(result).toMatchObject({state: "PAID", payment_preimage: "preimage"})
  })

  it("restores only the persisted melt inputs for authoritative UNPAID", async () => {
    const {getStored, proofService, service} = createService("UNPAID")

    const result = await service.payMeltQuote(mintUrl, quoteId)

    expect(proofService.setProofState).toHaveBeenLastCalledWith(
      mintUrl,
      [sendProof.secret],
      "ready"
    )
    expect(proofService.saveProofs).toHaveBeenCalledTimes(1)
    expect(getStored().meltPreview).toBeNull()
    expect(result.state).toBe("UNPAID")
  })

  it("keeps inputs inflight and the recovery preview for PENDING", async () => {
    const {getStored, proofService, service} = createService("PENDING")

    const result = await service.payMeltQuote(mintUrl, quoteId)

    expect(proofService.setProofState).toHaveBeenCalledTimes(2)
    expect(proofService.setProofState).toHaveBeenLastCalledWith(
      mintUrl,
      [sendProof.secret],
      "inflight"
    )
    expect(getStored()).toMatchObject({state: "PENDING", meltPreview: persistedPreview})
    expect(result.state).toBe("PENDING")
  })

  it("keeps the persisted recovery point after an ambiguous transport failure", async () => {
    const {getStored, service, wallet} = createService("PAID")
    wallet.completeMelt.mockRejectedValueOnce(new Error("Failed to fetch"))

    await expect(service.payMeltQuote(mintUrl, quoteId)).rejects.toThrow(
      "Failed to fetch"
    )

    expect(getStored()).toMatchObject({state: "PENDING", meltPreview: persistedPreview})
  })

  it("coalesces concurrent payment attempts for the same quote", async () => {
    const {service, wallet} = createService("PAID")

    const [first, second] = await Promise.all([
      service.payMeltQuote(mintUrl, quoteId),
      service.payMeltQuote(mintUrl, quoteId),
    ])

    expect(first.state).toBe("PAID")
    expect(second.state).toBe("PAID")
    expect(wallet.send).toHaveBeenCalledOnce()
    expect(wallet.completeMelt).toHaveBeenCalledOnce()
  })

  it("grosses up custom melt inputs for their future keyset fee", async () => {
    const feeAdjustedSend = proof("fee-adjusted-send", 7)
    const {proofService, service, wallet} = createService("PAID", {
      inputFeePpk: 500,
      keep: [],
      send: [feeAdjustedSend],
    })

    await service.payMeltQuote(mintUrl, quoteId)

    expect(wallet.getFeesForKeyset).toHaveBeenCalledWith(2, keysetId)
    expect(proofService.selectProofsToSend).toHaveBeenCalledWith(mintUrl, 7)
    expect(proofService.createOutputsAndIncrementCounters).toHaveBeenCalledWith(mintUrl, {
      keep: 1,
      send: 7,
      sendDenominations: [4, 1, 2],
    })
    expect(wallet.send).toHaveBeenCalledWith(
      7,
      [selectedProof],
      undefined,
      expect.objectContaining({send: {type: "custom", data: []}})
    )
  })
})

describe("MeltQuoteService.reconcilePendingMelts", () => {
  it("replays a persisted PENDING melt and saves PAID change and preimage", async () => {
    const {getStored, proofService, service, setStored, wallet} = createService("PAID")
    setStored({...quote, state: "PENDING", meltPreview: persistedPreview})
    wallet.checkMeltQuoteBolt11.mockResolvedValueOnce({...quote, state: "PENDING"})
    wallet.completeMelt.mockResolvedValueOnce({
      quote: {...quote, state: "PAID", payment_preimage: "recovered-preimage"},
      change: [changeProof],
    })

    const result = await service.reconcilePendingMelts()

    expect(result).toMatchObject({paid: [{mintUrl, quoteId}], failed: []})
    expect(wallet.completeMelt).toHaveBeenCalledWith(
      expect.objectContaining({
        inputs: [sendProof],
        outputData: [expect.any(OutputData)],
      })
    )
    expect(proofService.setProofState).toHaveBeenCalledWith(
      mintUrl,
      [sendProof.secret],
      "spent"
    )
    expect(proofService.saveProofs).toHaveBeenCalledWith(mintUrl, [
      {...changeProof, mintUrl, state: "ready"},
    ])
    expect(getStored()).toMatchObject({
      state: "PAID",
      payment_preimage: "recovered-preimage",
      meltPreview: null,
    })
  })

  it("restores persisted inputs and clears the preview for authoritative UNPAID", async () => {
    const {getStored, proofService, service, setStored, wallet} = createService("UNPAID")
    setStored({...quote, state: "PENDING", meltPreview: persistedPreview})
    wallet.checkMeltQuoteBolt11.mockResolvedValueOnce({...quote, state: "UNPAID"})

    const result = await service.reconcilePendingMelts()

    expect(result.unpaid).toEqual([{mintUrl, quoteId}])
    expect(wallet.completeMelt).not.toHaveBeenCalled()
    expect(proofService.setProofState).toHaveBeenCalledWith(
      mintUrl,
      [sendProof.secret],
      "ready"
    )
    expect(getStored()).toMatchObject({state: "UNPAID", meltPreview: null})
  })

  it("routes each persisted quote only through its own mint wallet", async () => {
    const mintA = "https://mint-a.example"
    const mintB = "https://mint-b.example"
    const quotes: MeltQuote[] = [
      {...quote, mintUrl: mintA, quote: "a-1", state: "PENDING"},
      {...quote, mintUrl: mintB, quote: "b-1", state: "PENDING"},
      {...quote, mintUrl: mintA, quote: "a-2", state: "PENDING"},
    ]
    const checks = new Map<string, string[]>()
    const makeWallet = (ownMint: string) => ({
      checkMeltQuoteBolt11: vi.fn(async (pending: MeltQuote) => {
        checks.set(ownMint, [...(checks.get(ownMint) ?? []), pending.quote])
        return {...pending, state: "UNPAID" as const}
      }),
    })
    const wallets = new Map([
      [mintA, makeWallet(mintA)],
      [mintB, makeWallet(mintB)],
    ])
    const walletService = {
      getWallet: vi.fn(async (url: string) => wallets.get(url)),
    }
    const repo = {
      getPendingMeltQuotes: vi.fn(async () => quotes),
      getMeltQuote: vi.fn(
        async (url: string, id: string) =>
          quotes.find((pending) => pending.mintUrl === url && pending.quote === id) ??
          null
      ),
      saveMeltQuote: vi.fn(async () => {}),
    }
    const proofService = {setProofState: vi.fn(async () => {})}
    const service = new MeltQuoteService(
      proofService as never,
      walletService as never,
      repo as never,
      {emit: vi.fn(async () => {})} as never
    )

    const result = await service.reconcilePendingMelts()

    expect(walletService.getWallet).toHaveBeenCalledTimes(2)
    expect(checks.get(mintA)).toEqual(["a-1", "a-2"])
    expect(checks.get(mintB)).toEqual(["b-1"])
    expect(result.unpaid).toHaveLength(3)
    expect(result.failed).toEqual([])
  })

  it("recovers already-paid change by matching restore outputs by B_", async () => {
    const B1 = `02${"44".repeat(32)}`
    const B2 = `02${"55".repeat(32)}`
    const preview: PersistedMeltPreview = {
      ...persistedPreview,
      outputData: [
        {
          ...persistedPreview.outputData[0],
          blindedMessage: {amount: 0, B_: B1, id: keysetId},
        },
        {
          ...persistedPreview.outputData[0],
          blindedMessage: {amount: 0, B_: B2, id: keysetId},
        },
      ],
    }
    const converted: Array<{B_: string; amount: number}> = []
    let restoredPayload: unknown
    vi.spyOn(OutputData.prototype, "toProof").mockImplementation(function (
      this: OutputData,
      signature
    ) {
      converted.push({B_: this.blindedMessage.B_, amount: this.blindedMessage.amount})
      return proof(`change-${this.blindedMessage.B_}`, signature.amount)
    })
    const {getStored, proofService, service, setStored, wallet} = createService("PAID")
    setStored({...quote, state: "PENDING", meltPreview: preview})
    wallet.checkMeltQuoteBolt11.mockResolvedValueOnce({
      ...quote,
      state: "PAID",
      payment_preimage: "already-paid",
    })
    wallet.completeMelt.mockRejectedValueOnce(new Error("quote already paid"))
    wallet.mint.restore.mockImplementationOnce(async (payload) => {
      restoredPayload = structuredClone(payload)
      return {
        outputs: [
          preview.outputData[1].blindedMessage,
          preview.outputData[0].blindedMessage,
        ],
        signatures: [
          {id: keysetId, amount: 2, C_: `02${"66".repeat(32)}`},
          {id: keysetId, amount: 1, C_: `02${"77".repeat(32)}`},
        ],
      }
    })
    proofService.getProofsByKeysetId.mockResolvedValueOnce([
      {...proof(`change-${B1}`, 1), mintUrl, state: "ready"},
    ])

    const result = await service.reconcilePendingMelts()

    expect(result.paid).toEqual([{mintUrl, quoteId}])
    expect(restoredPayload).toEqual({
      outputs: preview.outputData.map((output) => output.blindedMessage),
    })
    expect(converted).toEqual([
      {B_: B1, amount: 1},
      {B_: B2, amount: 2},
    ])
    expect(proofService.saveProofs).toHaveBeenCalledWith(mintUrl, [
      {...proof(`change-${B2}`, 2), mintUrl, state: "ready"},
    ])
    expect(proofService.setProofState).toHaveBeenCalledWith(
      mintUrl,
      [sendProof.secret],
      "spent"
    )
    expect(getStored()).toMatchObject({
      state: "PAID",
      payment_preimage: "already-paid",
      meltPreview: null,
    })
  })
})
