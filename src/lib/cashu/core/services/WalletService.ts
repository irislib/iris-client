import {KeyChain, Mint, Wallet, type MintKeys, type MintKeyset} from "@cashu/cashu-ts"
import type {MintService} from "./MintService"
import type {Logger} from "../logging/Logger.ts"
import type {SeedService} from "./SeedService.ts"

interface CachedWallet {
  wallet: Wallet
  lastCheck: number
}

export class WalletService {
  private walletCache: Map<string, CachedWallet> = new Map()
  private readonly CACHE_TTL = 5 * 60 * 1000
  private readonly mintService: MintService
  private readonly seedService: SeedService
  private inFlight: Map<string, Promise<Wallet>> = new Map()
  private readonly logger?: Logger

  constructor(mintService: MintService, seedService: SeedService, logger?: Logger) {
    this.mintService = mintService
    this.seedService = seedService
    this.logger = logger
  }

  async getWallet(mintUrl: string): Promise<Wallet> {
    if (!mintUrl || mintUrl.trim().length === 0) {
      throw new Error("mintUrl is required")
    }

    // Serve from cache when fresh
    const cached = this.walletCache.get(mintUrl)
    const now = Date.now()
    if (cached && now - cached.lastCheck < this.CACHE_TTL) {
      this.logger?.debug("Wallet served from cache", {mintUrl})
      return cached.wallet
    }

    // De-duplicate concurrent requests per mintUrl
    const existing = this.inFlight.get(mintUrl)
    if (existing) return existing

    const promise = this.buildWallet(mintUrl).finally(() => {
      this.inFlight.delete(mintUrl)
    })
    this.inFlight.set(mintUrl, promise)
    return promise
  }

  async getWalletWithActiveKeysetId(mintUrl: string): Promise<{
    wallet: Wallet
    keysetId: string
    keyset: MintKeyset
    keys: MintKeys
  }> {
    const wallet = await this.getWallet(mintUrl)
    const keyset = wallet.getKeyset()
    const keys = keyset.toMintKeys()
    if (!keys) throw new Error(`No keys loaded for keyset ${keyset.id}`)
    return {
      wallet,
      keysetId: keyset.id,
      keyset: keyset.toMintKeyset(),
      keys,
    }
  }

  /**
   * Clear cached wallet for a specific mint URL
   */
  clearCache(mintUrl: string): void {
    this.walletCache.delete(mintUrl)
    this.logger?.debug("Wallet cache cleared", {mintUrl})
  }

  /**
   * Clear all cached wallets
   */
  clearAllCaches(): void {
    this.walletCache.clear()
    this.logger?.debug("All wallet caches cleared")
  }

  /**
   * Force refresh mint data and get fresh wallet
   */
  async refreshWallet(mintUrl: string): Promise<Wallet> {
    this.clearCache(mintUrl)
    this.inFlight.delete(mintUrl)
    await this.mintService.updateMintData(mintUrl)
    return this.getWallet(mintUrl)
  }
  private async buildWallet(mintUrl: string): Promise<Wallet> {
    let seed: Uint8Array | undefined
    for (let attempt = 0; attempt < 2; attempt += 1) {
      // Try to get fresh mint data, fall back to cache if offline
      let mint, keysets
      try {
        ;({mint, keysets} = await this.mintService.ensureUpdatedMint(mintUrl))
      } catch (err) {
        // If network error, use cached data for offline operation
        const isNetworkError =
          err instanceof Error &&
          (err.message.includes("Failed to fetch") ||
            err.message.includes("NetworkError"))

        if (isNetworkError) {
          this.logger?.warn("Mint unreachable, using cached keys", {mintUrl})
          ;({mint, keysets} = await this.mintService.getCachedMint(mintUrl))
        } else {
          throw err
        }
      }

      const validKeysets = keysets.filter(
        (keyset) => keyset.keypairs && Object.keys(keyset.keypairs).length > 0
      )

      if (validKeysets.length === 0) {
        throw new Error(`No valid keysets found for mint ${mintUrl}`)
      }

      const keys: MintKeys[] = validKeysets.map((keyset) => ({
        id: keyset.id,
        unit: keyset.unit,
        active: keyset.active,
        input_fee_ppk: keyset.feePpk,
        final_expiry: keyset.finalExpiry,
        keys: keyset.keypairs,
      }))

      const compatibleKeysets: MintKeyset[] = validKeysets.map((k) => ({
        id: k.id,
        unit: k.unit,
        active: k.active,
        input_fee_ppk: k.feePpk,
        final_expiry: k.finalExpiry,
      }))

      seed ??= await this.seedService.getSeed()

      const logger = this.logger?.child?.({module: "Wallet"})
      const cashuMint = new Mint(mintUrl, {logger})
      const wallet = new Wallet(cashuMint, {
        unit: "sat",
        logger,
        bip39seed: seed,
      })
      const keyChainCache = KeyChain.mintToCacheDTO(
        "sat",
        mintUrl,
        compatibleKeysets,
        keys
      )
      wallet.loadMintFromCache(mint.mintInfo, keyChainCache)

      try {
        wallet.getKeyset()
      } catch (err) {
        if (attempt > 0) throw err
        this.logger?.warn("Cached keysets unusable, refreshing mint data", {mintUrl, err})
        await this.mintService.updateMintData(mintUrl)
        continue
      }

      this.walletCache.set(mintUrl, {
        wallet,
        lastCheck: Date.now(),
      })

      this.logger?.info("Wallet built", {mintUrl, keysetCount: validKeysets.length})
      return wallet
    }
    throw new Error(`No usable active keyset found for mint ${mintUrl}`)
  }
}
