import {Mint, type MintAllKeysets} from "@cashu/cashu-ts"
import type {MintInfo} from "../types"

//TODO: This adapter is currently not rate limited. As long as it's only used to fetch mint info and keysets, this is fine.

export class MintAdapter {
  private cashuMints: Record<string, Mint> = {}

  async fetchMintInfo(mintUrl: string): Promise<MintInfo> {
    const cashuMint = await this.getCashuMint(mintUrl)
    return await cashuMint.getInfo()
  }

  async fetchKeysets(mintUrl: string): Promise<MintAllKeysets> {
    const cashuMint = await this.getCashuMint(mintUrl)
    return await cashuMint.getKeySets()
  }

  async fetchKeysForId(mintUrl: string, id: string): Promise<Record<number, string>> {
    const cashuMint = await this.getCashuMint(mintUrl)
    const {keysets} = await cashuMint.getKeys(id)
    if (keysets.length !== 1 || !keysets[0]) {
      throw new Error(`Expected 1 keyset for ${id}, got ${keysets.length}`)
    }
    return keysets[0].keys
  }

  private async getCashuMint(mintUrl: string): Promise<Mint> {
    if (!this.cashuMints[mintUrl]) {
      this.cashuMints[mintUrl] = new Mint(mintUrl)
    }
    return this.cashuMints[mintUrl]
  }

  // Polling helpers - stubbed for now
  // Check current state of a bolt11 mint quote
  async checkMintQuoteState(_mintUrl: string, _quoteId: string): Promise<unknown> {
    // TODO: implement HTTP call
    return {}
  }

  // Check current state of a bolt11 melt quote
  async checkMeltQuoteState(_mintUrl: string, _quoteId: string): Promise<unknown> {
    // TODO: implement HTTP call
    return {}
  }

  // Batch check of proof states by secrets (up to 100 per request)
  async checkProofStates(_mintUrl: string, _proofSecrets: string[]): Promise<unknown[]> {
    // TODO: implement HTTP call (batch)
    return []
  }
}
