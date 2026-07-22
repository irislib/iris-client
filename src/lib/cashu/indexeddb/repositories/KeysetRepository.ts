import type {KeysetRepository, Keyset} from "../../core/index"
import type {IdbDb, KeysetRow} from "../lib/db.ts"

export class IdbKeysetRepository implements KeysetRepository {
  private readonly db: IdbDb

  constructor(db: IdbDb) {
    this.db = db
  }

  async getKeysetsByMintUrl(mintUrl: string): Promise<Keyset[]> {
    const rows = (await (this.db as any)
      .table("coco_cashu_keysets")
      .where("mintUrl")
      .equals(mintUrl)
      .toArray()) as KeysetRow[]
    return rows.map(
      (r) =>
        ({
          mintUrl: r.mintUrl,
          id: r.id,
          unit: r.unit || "sat",
          keypairs: JSON.parse(r.keypairs),
          active: !!r.active,
          feePpk: r.feePpk,
          finalExpiry: r.finalExpiry,
          updatedAt: r.updatedAt,
        }) satisfies Keyset
    )
  }

  async getKeysetById(mintUrl: string, id: string): Promise<Keyset | null> {
    const row = (await (this.db as any)
      .table("coco_cashu_keysets")
      .get([mintUrl, id])) as KeysetRow | undefined
    if (!row) return null
    return {
      mintUrl: row.mintUrl,
      id: row.id,
      unit: row.unit || "sat",
      keypairs: JSON.parse(row.keypairs),
      active: !!row.active,
      feePpk: row.feePpk,
      finalExpiry: row.finalExpiry,
      updatedAt: row.updatedAt,
    } satisfies Keyset
  }

  async updateKeyset(keyset: Omit<Keyset, "keypairs" | "updatedAt">): Promise<void> {
    const existing = (await (this.db as any)
      .table("coco_cashu_keysets")
      .get([keyset.mintUrl, keyset.id])) as KeysetRow | undefined
    const now = Math.floor(Date.now() / 1000)
    if (!existing) {
      await (this.db as any).table("coco_cashu_keysets").put({
        mintUrl: keyset.mintUrl,
        id: keyset.id,
        unit: keyset.unit,
        keypairs: JSON.stringify({}),
        active: keyset.active ? 1 : 0,
        feePpk: keyset.feePpk,
        finalExpiry: keyset.finalExpiry,
        updatedAt: now,
      } satisfies KeysetRow)
      return
    }
    await (this.db as any).table("coco_cashu_keysets").put({
      ...existing,
      unit: keyset.unit,
      active: keyset.active ? 1 : 0,
      feePpk: keyset.feePpk,
      finalExpiry: keyset.finalExpiry ?? existing.finalExpiry,
      updatedAt: now,
    } as KeysetRow)
  }

  async addKeyset(keyset: Omit<Keyset, "updatedAt">): Promise<void> {
    const now = Math.floor(Date.now() / 1000)
    const row: KeysetRow = {
      mintUrl: keyset.mintUrl,
      id: keyset.id,
      unit: keyset.unit,
      keypairs: JSON.stringify(keyset.keypairs ?? {}),
      active: keyset.active ? 1 : 0,
      feePpk: keyset.feePpk,
      finalExpiry: keyset.finalExpiry,
      updatedAt: now,
    }
    await (this.db as any).table("coco_cashu_keysets").put(row)
  }

  async deleteKeyset(mintUrl: string, keysetId: string): Promise<void> {
    await (this.db as any).table("coco_cashu_keysets").delete([mintUrl, keysetId])
  }
}
