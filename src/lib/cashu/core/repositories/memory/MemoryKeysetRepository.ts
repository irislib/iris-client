import type {Keyset} from "../../models/Keyset"
import type {KeysetRepository} from ".."

export class MemoryKeysetRepository implements KeysetRepository {
  private keysetsByMint: Map<string, Map<string, Keyset>> = new Map()

  private getMintMap(mintUrl: string): Map<string, Keyset> {
    if (!this.keysetsByMint.has(mintUrl)) {
      this.keysetsByMint.set(mintUrl, new Map())
    }
    return this.keysetsByMint.get(mintUrl)!
  }

  async getKeysetsByMintUrl(mintUrl: string): Promise<Keyset[]> {
    return Array.from(this.getMintMap(mintUrl).values())
  }

  async getKeysetById(mintUrl: string, id: string): Promise<Keyset | null> {
    return this.getMintMap(mintUrl).get(id) ?? null
  }

  async updateKeyset(keyset: Omit<Keyset, "keypairs" | "updatedAt">): Promise<void> {
    const mintMap = this.getMintMap(keyset.mintUrl)
    const existing = mintMap.get(keyset.id)
    if (!existing) {
      // If unknown, create an empty one and then update
      mintMap.set(keyset.id, {
        ...keyset,
        keypairs: {},
        updatedAt: Math.floor(Date.now() / 1000),
      })
      return
    }
    mintMap.set(keyset.id, {
      ...existing,
      unit: keyset.unit,
      active: keyset.active,
      feePpk: keyset.feePpk,
      finalExpiry: keyset.finalExpiry ?? existing.finalExpiry,
      updatedAt: Math.floor(Date.now() / 1000),
    })
  }

  async addKeyset(keyset: Omit<Keyset, "updatedAt">): Promise<void> {
    const mintMap = this.getMintMap(keyset.mintUrl)
    mintMap.set(keyset.id, {
      ...keyset,
      updatedAt: Math.floor(Date.now() / 1000),
    })
  }

  async deleteKeyset(mintUrl: string, keysetId: string): Promise<void> {
    this.getMintMap(mintUrl).delete(keysetId)
  }
}
