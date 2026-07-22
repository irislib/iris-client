import type {MintQuoteState, MeltQuoteState, Token} from "@cashu/cashu-ts"
import type {
  HistoryEntry,
  MintHistoryEntry,
  MeltHistoryEntry,
  ReceiveHistoryEntry,
  SendHistoryEntry,
} from "../../core/index"
import type {IdbDb} from "../lib/db.ts"
import Dexie from "dexie"

type NewHistoryEntry =
  | Omit<MintHistoryEntry, "id">
  | Omit<MeltHistoryEntry, "id">
  | Omit<SendHistoryEntry, "id">
  | Omit<ReceiveHistoryEntry, "id">

type UpdatableHistoryEntry =
  Omit<MintHistoryEntry, "id" | "createdAt"> | Omit<MeltHistoryEntry, "id" | "createdAt">

export class IdbHistoryRepository {
  private readonly db: IdbDb

  constructor(db: IdbDb) {
    this.db = db
  }

  async getPaginatedHistoryEntries(
    limit: number,
    offset: number
  ): Promise<HistoryEntry[]> {
    const coll = this.db.table("coco_cashu_history") as Dexie.Table<any, number>
    const rows = await coll
      .orderBy("createdAt")
      .reverse()
      .offset(offset)
      .limit(limit)
      .toArray()
    return rows.map((r) => this.rowToEntry(r))
  }

  async addHistoryEntry(history: NewHistoryEntry): Promise<HistoryEntry> {
    const row = this.entryToRow(history)
    const id = (await (this.db as any).table("coco_cashu_history").add(row)) as number
    const stored = await (this.db as any).table("coco_cashu_history").get(id)
    return this.rowToEntry(stored)
  }

  async getMintHistoryEntry(
    mintUrl: string,
    quoteId: string
  ): Promise<MintHistoryEntry | null> {
    const row = await (this.db as any)
      .table("coco_cashu_history")
      .where("[mintUrl+quoteId+type]")
      .equals([mintUrl, quoteId, "mint"])
      .last()
    if (!row) return null
    const entry = this.rowToEntry(row)
    return entry.type === "mint" ? entry : null
  }

  async getMeltHistoryEntry(
    mintUrl: string,
    quoteId: string
  ): Promise<MeltHistoryEntry | null> {
    const row = await (this.db as any)
      .table("coco_cashu_history")
      .where("[mintUrl+quoteId+type]")
      .equals([mintUrl, quoteId, "melt"])
      .last()
    if (!row) return null
    const entry = this.rowToEntry(row)
    return entry.type === "melt" ? entry : null
  }

  async updateHistoryEntry(history: UpdatableHistoryEntry): Promise<HistoryEntry> {
    const coll = (this.db as any).table("coco_cashu_history")
    const rows = await coll
      .where("[mintUrl+quoteId+type]")
      .equals([history.mintUrl, history.quoteId, history.type])
      .toArray()
    if (!rows.length) throw new Error("History entry not found")
    const row = rows[rows.length - 1]
    const updated = {
      ...row,
      unit: history.unit,
      amount: history.amount,
      metadata: history.metadata ?? null,
    }
    if (history.type === "mint") {
      updated.state = history.state
      updated.paymentRequest = history.paymentRequest
    } else {
      updated.state = history.state
    }
    await coll.update(row.id, updated)
    const fresh = await coll.get(row.id)
    return this.rowToEntry(fresh)
  }

  async deleteHistoryEntry(mintUrl: string, quoteId: string): Promise<void> {
    const coll = (this.db as any).table("coco_cashu_history")
    const rows = await coll
      .where("[mintUrl+quoteId+type]")
      .between([mintUrl, quoteId, ""], [mintUrl, quoteId, ""])
      .toArray()
    const ids = rows.map((r: any) => r.id)
    await coll.bulkDelete(ids)
  }

  private entryToRow(history: NewHistoryEntry): any {
    const base = {
      mintUrl: history.mintUrl,
      type: history.type,
      unit: history.unit,
      amount: history.amount,
      createdAt: history.createdAt,
      metadata: history.metadata ?? null,
    } as any
    if (history.type === "mint") {
      base.quoteId = history.quoteId
      base.state = history.state as MintQuoteState
      base.paymentRequest = history.paymentRequest
    } else if (history.type === "melt") {
      base.quoteId = history.quoteId
      base.state = history.state as MeltQuoteState
    } else if (history.type === "send") {
      base.tokenJson = JSON.stringify(history.token as Token)
    }
    return base
  }

  private rowToEntry(row: any): HistoryEntry {
    const base = {
      id: String(row.id),
      createdAt: row.createdAt,
      mintUrl: row.mintUrl,
      unit: row.unit,
      metadata: row.metadata ?? undefined,
    } as const
    if (row.type === "mint") {
      return {
        ...base,
        type: "mint",
        paymentRequest: row.paymentRequest ?? "",
        quoteId: row.quoteId ?? "",
        state: (row.state ?? "UNPAID") as MintQuoteState,
        amount: row.amount,
      }
    }
    if (row.type === "melt") {
      return {
        ...base,
        type: "melt",
        quoteId: row.quoteId ?? "",
        state: (row.state ?? "UNPAID") as MeltQuoteState,
        amount: row.amount,
      }
    }
    if (row.type === "send") {
      return {
        ...base,
        type: "send",
        amount: row.amount,
        token: row.tokenJson ? (JSON.parse(row.tokenJson) as Token) : ({} as Token),
      }
    }
    return {...base, type: "receive", amount: row.amount} as HistoryEntry
  }
}
