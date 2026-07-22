import {createNewMintKeys, deriveKeysetId, serializeMintKeys} from "@cashu/cashu-ts"
import {afterEach, describe, expect, it, vi} from "vitest"
import {IndexedDbRepositories} from "../../indexeddb"
import {MintService} from "./MintService"
import {SeedService} from "./SeedService"
import {WalletService} from "./WalletService"

const FINAL_EXPIRY = 2_000_000_000
const INPUT_FEE_PPK = 100
const MINT_INFO = {
  name: "Test mint",
  pubkey: "",
  version: "test",
  contact: [],
  nuts: {
    4: {methods: [], disabled: false},
    5: {methods: [], disabled: false},
  },
} as never

let repositories: IndexedDbRepositories | undefined

function createV2Keyset(seedByte: number) {
  const generated = createNewMintKeys(8, new Uint8Array(32).fill(seedByte), {
    unit: "sat",
    expiry: FINAL_EXPIRY,
    input_fee_ppk: INPUT_FEE_PPK,
    versionByte: 1,
  })
  const keypairs = Object.fromEntries(
    Object.entries(serializeMintKeys(generated.pubKeys)).map(([amount, key]) => [
      Number(amount),
      key,
    ])
  )
  return {keysetId: generated.keysetId, keypairs}
}

async function setupRepositories(mintUrl: string, updatedAt: number) {
  repositories = new IndexedDbRepositories({
    name: `cashu-keyset-${crypto.randomUUID()}`,
  })
  await repositories.init()
  await repositories.mintRepository.addNewMint({
    mintUrl,
    name: "Test mint",
    mintInfo: MINT_INFO,
    createdAt: 0,
    updatedAt,
  })
  return repositories
}

function setupMintService(
  db: IndexedDbRepositories,
  {keysetId, keypairs}: ReturnType<typeof createV2Keyset>
) {
  const mintService = new MintService(db.mintRepository, db.keysetRepository)
  const mintAdapter = {
    fetchMintInfo: vi.fn(async () => MINT_INFO),
    fetchKeysets: vi.fn(async () => ({
      keysets: [
        {
          id: keysetId,
          unit: "sat",
          active: true,
          input_fee_ppk: INPUT_FEE_PPK,
          final_expiry: FINAL_EXPIRY,
        },
      ],
    })),
    fetchKeysForId: vi.fn(async () => keypairs),
  }
  Reflect.set(mintService, "mintAdapter", mintAdapter)
  return {mintService, mintAdapter}
}

afterEach(async () => {
  if (repositories) await repositories.db.delete()
  repositories = undefined
})

describe("WalletService keyset cache", () => {
  it("keeps verified v2 keys whose ID includes final_expiry", async () => {
    const mintUrl = "https://mint.example"
    const keyset = createV2Keyset(7)
    expect(
      deriveKeysetId(keyset.keypairs, {
        unit: "sat",
        expiry: FINAL_EXPIRY,
        input_fee_ppk: INPUT_FEE_PPK,
        versionByte: 1,
      })
    ).toBe(keyset.keysetId)
    expect(
      deriveKeysetId(keyset.keypairs, {
        unit: "sat",
        input_fee_ppk: INPUT_FEE_PPK,
        versionByte: 1,
      })
    ).not.toBe(keyset.keysetId)

    const db = await setupRepositories(mintUrl, 0)
    const {mintService, mintAdapter} = setupMintService(db, keyset)
    await mintService.updateMintData(mintUrl)

    const cachedKeyset = await db.keysetRepository.getKeysetById(mintUrl, keyset.keysetId)
    expect(cachedKeyset?.finalExpiry).toBe(FINAL_EXPIRY)

    const walletService = new WalletService(
      mintService,
      new SeedService(async () => new Uint8Array(64).fill(1))
    )
    const {
      wallet,
      keyset: metadata,
      keys,
    } = await walletService.getWalletWithActiveKeysetId(mintUrl)

    expect(metadata.final_expiry).toBe(FINAL_EXPIRY)
    expect(keys.final_expiry).toBe(FINAL_EXPIRY)
    expect(wallet.getKeyset(keyset.keysetId).verify()).toBe(true)
    expect(mintAdapter.fetchKeysets).toHaveBeenCalledOnce()
  })

  it("refreshes a legacy v2 cache missing final_expiry exactly once", async () => {
    const mintUrl = "https://legacy-mint.example"
    const keyset = createV2Keyset(9)
    const db = await setupRepositories(mintUrl, Math.floor(Date.now() / 1000))
    await db.keysetRepository.addKeyset({
      mintUrl,
      id: keyset.keysetId,
      unit: "sat",
      keypairs: keyset.keypairs,
      active: true,
      feePpk: INPUT_FEE_PPK,
    })

    const {mintService, mintAdapter} = setupMintService(db, keyset)
    const updateMintData = vi.spyOn(mintService, "updateMintData")
    const seedGetter = vi.fn(async () => new Uint8Array(64).fill(1))
    const walletService = new WalletService(mintService, new SeedService(seedGetter))

    const {
      wallet,
      keyset: metadata,
      keys,
    } = await walletService.getWalletWithActiveKeysetId(mintUrl)

    expect(updateMintData).toHaveBeenCalledOnce()
    expect(mintAdapter.fetchKeysets).toHaveBeenCalledOnce()
    expect(mintAdapter.fetchKeysForId).not.toHaveBeenCalled()
    expect(seedGetter).toHaveBeenCalledOnce()
    expect(metadata.final_expiry).toBe(FINAL_EXPIRY)
    expect(keys.final_expiry).toBe(FINAL_EXPIRY)
    expect(wallet.getKeyset(keyset.keysetId).verify()).toBe(true)
    await expect(walletService.getWallet(mintUrl)).resolves.toBe(wallet)
    expect(updateMintData).toHaveBeenCalledOnce()
  })
})
