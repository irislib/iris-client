import {describe, expect, it, vi} from "vitest"
import {getEncodedToken, type Proof, type Token} from "@cashu/cashu-ts"
import {WalletApi} from "./WalletApi"
import {UnknownMintError} from "../models"

const proof: Proof = {
  amount: 1,
  id: "0011223344556677",
  secret: "test-secret",
  C: `02${"11".repeat(32)}`,
}

const token: Token = {
  mint: "https://mint.example",
  proofs: [proof],
  memo: "hello",
}

const encodedToken = getEncodedToken(token)
const normalizedToken = {...token, unit: "sat"}

function createApi({known = true}: {known?: boolean} = {}) {
  const receiveOutput = {secret: new Uint8Array([1])}
  const wallet = {
    decodeToken: vi.fn(() => token),
    getFeesForProofs: vi.fn(() => 0),
    receive: vi.fn(async () => [proof]),
  }
  const mintService = {isKnownMint: vi.fn(async () => known)}
  const walletService = {
    getWalletWithActiveKeysetId: vi.fn(async () => ({wallet, keysetId: proof.id})),
  }
  const proofService = {
    getReadyProofs: vi.fn(async () => []),
    createOutputsAndIncrementCounters: vi.fn(async () => ({
      keep: [receiveOutput],
      send: [],
    })),
    saveProofs: vi.fn(async () => {}),
  }
  const eventBus = {emit: vi.fn(async () => {})}

  const api = new WalletApi(
    mintService as never,
    walletService as never,
    proofService as never,
    {} as never,
    eventBus as never
  )

  return {
    api,
    eventBus,
    mintService,
    proofService,
    receiveOutput,
    wallet,
    walletService,
  }
}

describe("WalletApi.receive", () => {
  it("hydrates v3 tokens with the mint wallet and uses persisted deterministic outputs", async () => {
    const {api, eventBus, proofService, receiveOutput, wallet} = createApi()

    await api.receive(encodedToken)

    expect(wallet.decodeToken).toHaveBeenCalledWith(encodedToken)
    expect(proofService.createOutputsAndIncrementCounters).toHaveBeenCalledWith(
      token.mint,
      {keep: 1, send: 0}
    )
    expect(wallet.receive).toHaveBeenCalledWith(
      normalizedToken,
      {keysetId: proof.id, proofsWeHave: []},
      {type: "custom", data: [receiveOutput]}
    )
    expect(proofService.saveProofs).toHaveBeenCalledWith(token.mint, [
      {...proof, mintUrl: token.mint, state: "ready"},
    ])
    expect(eventBus.emit).toHaveBeenCalledWith("receive:created", {
      mintUrl: token.mint,
      token: normalizedToken,
      amount: 1,
    })
  })

  it("defaults object tokens to sats before passing them to Cashu v3", async () => {
    const {api, wallet} = createApi()

    await api.receive(token)

    expect(wallet.decodeToken).not.toHaveBeenCalled()
    expect(wallet.receive).toHaveBeenCalledWith(
      normalizedToken,
      {keysetId: proof.id, proofsWeHave: []},
      {type: "custom", data: expect.any(Array)}
    )
  })

  it("rejects unknown token mints before loading wallet data", async () => {
    const {api, walletService} = createApi({known: false})

    await expect(api.receive(encodedToken)).rejects.toBeInstanceOf(UnknownMintError)
    expect(walletService.getWalletWithActiveKeysetId).not.toHaveBeenCalled()
  })
})

describe("WalletApi.send", () => {
  it("grosses up custom outputs so the recipient receives the requested net amount", async () => {
    const sourceProof = {...proof, amount: 8, secret: "source"}
    const keepProof = {...proof, amount: 1, secret: "keep"}
    const sendProof = {...proof, amount: 6, secret: "send"}
    const outputData = {keep: [{secret: "keep-output"}], send: [{secret: "send-output"}]}
    const keys = {
      id: proof.id,
      unit: "sat",
      keys: Object.fromEntries(
        [1, 2, 4, 8].map((amount) => [amount, `02${"22".repeat(32)}`])
      ),
    }
    const wallet = {
      getFeesForProofs: vi.fn(() => 1),
      getFeesForKeyset: vi.fn(() => 1),
      send: vi.fn(async () => ({keep: [keepProof], send: [sendProof]})),
    }
    const walletService = {
      getWalletWithActiveKeysetId: vi.fn(async () => ({wallet, keys})),
    }
    const proofService = {
      selectProofsToSend: vi.fn(async () => [sourceProof]),
      getReadyProofs: vi.fn(async () => [sourceProof]),
      createOutputsAndIncrementCounters: vi.fn(async () => outputData),
      saveProofs: vi.fn(async () => {}),
      setProofState: vi.fn(async () => {}),
    }
    const eventBus = {emit: vi.fn(async () => {})}
    const api = new WalletApi(
      {} as never,
      walletService as never,
      proofService as never,
      {} as never,
      eventBus as never
    )

    const result = await api.send(token.mint, 5, "fee-aware")

    expect(proofService.createOutputsAndIncrementCounters).toHaveBeenCalledWith(
      token.mint,
      {keep: 1, send: 6, sendDenominations: [4, 1, 1]}
    )
    expect(wallet.send).toHaveBeenCalledWith(
      6,
      [sourceProof],
      {proofsWeHave: [sourceProof]},
      {
        keep: {type: "custom", data: outputData.keep},
        send: {type: "custom", data: outputData.send},
      }
    )
    expect(result).toEqual({
      mint: token.mint,
      proofs: [sendProof],
      unit: "sat",
      memo: "fee-aware",
    })
    expect(eventBus.emit).toHaveBeenCalledWith("send:created", {
      mintUrl: token.mint,
      token: result,
      amount: 5,
    })
  })
})
