import {afterEach, describe, expect, it} from "vitest"
import {initializeCoco, type Manager} from "./Manager"
import {MemoryRepositories} from "./repositories/memory"
import {FakeCashuMint} from "./test/FakeCashuMint"

let mint: FakeCashuMint | undefined
const managers: Manager[] = []

afterEach(async () => {
  await Promise.all(managers.splice(0).map((manager) => manager.dispose()))
  await mint?.stop()
  mint = undefined
})

async function createWallet(seedByte: number) {
  const repo = new MemoryRepositories()
  const manager = await initializeCoco({
    repo,
    seedGetter: async () => new Uint8Array(64).fill(seedByte),
    watchers: {
      mintQuoteWatcher: {disabled: true},
      proofStateWatcher: {disabled: true},
    },
    processors: {mintQuoteProcessor: {disabled: true}},
  })
  managers.push(manager)
  return {manager, repo}
}

describe("Cashu wallet journey", () => {
  it("mints, sends, receives, and melts against a cryptographic local mint", async () => {
    mint = await FakeCashuMint.start({
      inputFeePpk: 1_000,
      meltAmount: 7,
      meltFeeReserve: 2,
      meltActualFee: 1,
    })
    const alice = await createWallet(1)
    const bob = await createWallet(2)

    await Promise.all([
      alice.manager.mint.addMint(mint.url),
      bob.manager.mint.addMint(mint.url),
    ])

    const mintQuote = await alice.manager.quotes.createMintQuote(mint.url, 64)
    expect(mintQuote.state).toBe("PAID")
    await alice.manager.quotes.redeemMintQuote(mint.url, mintQuote.quote)
    await expect(alice.manager.wallet.getBalances()).resolves.toEqual({[mint.url]: 64})

    const token = await alice.manager.wallet.send(mint.url, 13, "integration send")
    expect(token.memo).toBe("integration send")
    const tokenAmount = token.proofs.reduce((sum, proof) => sum + proof.amount, 0)
    const receiveFee = Math.ceil((token.proofs.length * mint.inputFeePpk) / 1_000)
    expect(tokenAmount - receiveFee).toBe(13)
    const aliceAfterSend = 64 - 1 - tokenAmount
    await expect(alice.manager.wallet.getBalances()).resolves.toEqual({
      [mint.url]: aliceAfterSend,
    })

    await bob.manager.wallet.receive(token)
    await expect(bob.manager.wallet.getBalances()).resolves.toEqual({[mint.url]: 13})
    const aliceHistory = await alice.manager.history.getPaginatedHistory()
    const bobHistory = await bob.manager.history.getPaginatedHistory()
    expect(aliceHistory.find((entry) => entry.type === "send")).toMatchObject({
      amount: 13,
    })
    expect(bobHistory.find((entry) => entry.type === "receive")).toMatchObject({
      amount: 13,
    })
    expect(mint.transactions.slice(0, 2)).toEqual([
      {kind: "swap", inputAmount: 64, inputFee: 1, outputAmount: 63},
      {
        kind: "swap",
        inputAmount: tokenAmount,
        inputFee: receiveFee,
        outputAmount: 13,
      },
    ])
    await expect(bob.manager.wallet.receive(token)).rejects.toThrow("Proof already spent")
    await expect(bob.manager.wallet.getBalances()).resolves.toEqual({[mint.url]: 13})

    const meltQuote = await alice.manager.quotes.createMeltQuote(
      mint.url,
      "lnbc7n1irisjourney"
    )
    await alice.manager.quotes.payMeltQuote(mint.url, meltQuote.quote)

    const [meltSwap, meltPayment] = mint.transactions.slice(2)
    expect(meltSwap).toMatchObject({kind: "swap"})
    expect(meltPayment).toMatchObject({kind: "melt", changeAmount: 2})
    const expectedAliceBalance =
      aliceAfterSend -
      meltSwap.inputFee -
      (meltPayment.inputAmount - (meltPayment.changeAmount ?? 0))
    await expect(alice.manager.wallet.getBalances()).resolves.toEqual({
      [mint.url]: expectedAliceBalance,
    })
    await expect(
      alice.repo.meltQuoteRepository.getMeltQuote(mint.url, meltQuote.quote)
    ).resolves.toMatchObject({state: "PAID"})
    expect(mint.transactions).toHaveLength(4)
  })

  it("recovers paid melt change after the mint response is lost", async () => {
    mint = await FakeCashuMint.start({
      inputFeePpk: 1_000,
      meltAmount: 7,
      meltFeeReserve: 2,
      meltActualFee: 1,
      dropFirstMeltResponse: true,
    })
    const alice = await createWallet(3)
    await alice.manager.mint.addMint(mint.url)
    const mintQuote = await alice.manager.quotes.createMintQuote(mint.url, 32)
    await alice.manager.quotes.redeemMintQuote(mint.url, mintQuote.quote)

    const meltQuote = await alice.manager.quotes.createMeltQuote(
      mint.url,
      "lnbc7n1irisrecovery"
    )
    await expect(
      alice.manager.quotes.payMeltQuote(mint.url, meltQuote.quote)
    ).rejects.toThrow()
    await expect(
      alice.repo.meltQuoteRepository.getMeltQuote(mint.url, meltQuote.quote)
    ).resolves.toMatchObject({state: "PENDING", meltPreview: expect.any(Object)})

    const recovery = await alice.manager.quotes.reconcilePendingMelts()

    expect(recovery).toMatchObject({
      paid: [{mintUrl: mint.url, quoteId: meltQuote.quote}],
      failed: [],
    })
    await expect(
      alice.repo.meltQuoteRepository.getMeltQuote(mint.url, meltQuote.quote)
    ).resolves.toMatchObject({
      state: "PAID",
      payment_preimage: "00".repeat(32),
      meltPreview: null,
    })
    const [meltSwap, meltPayment] = mint.transactions
    const expectedBalance =
      32 - meltSwap.inputFee - (meltPayment.inputAmount - (meltPayment.changeAmount ?? 0))
    await expect(alice.manager.wallet.getBalances()).resolves.toEqual({
      [mint.url]: expectedBalance,
    })
  })
})
