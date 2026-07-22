import type Dexie from "dexie"
import type {CounterRepository, Counter} from "../../core/index"
import type {IdbDb, CounterRow} from "../lib/db.ts"

export class IdbCounterRepository implements CounterRepository {
  private readonly db: Dexie

  constructor(db: IdbDb) {
    // Widen the subclass to Dexie to avoid its recursive transaction overloads.
    this.db = db as unknown as Dexie
  }

  private get table() {
    return this.db.table<CounterRow, [string, string]>("coco_cashu_counters")
  }

  async getCounter(mintUrl: string, keysetId: string): Promise<Counter | null> {
    const row = await this.table.get([mintUrl, keysetId])
    if (!row) return null
    return {mintUrl, keysetId, counter: row.counter} satisfies Counter
  }

  async reserveCounter(
    mintUrl: string,
    keysetId: string,
    count: number
  ): Promise<number> {
    return this.db.transaction("rw", this.table, async () => {
      const row = await this.table.get([mintUrl, keysetId])
      const start = row?.counter ?? 0
      await this.table.put({
        mintUrl,
        keysetId,
        counter: start + count,
      } satisfies CounterRow)
      return start
    })
  }

  async advanceCounter(
    mintUrl: string,
    keysetId: string,
    minimum: number
  ): Promise<number> {
    return this.db.transaction("rw", this.table, async () => {
      const row = await this.table.get([mintUrl, keysetId])
      const counter = Math.max(row?.counter ?? 0, minimum)
      await this.table.put({mintUrl, keysetId, counter} satisfies CounterRow)
      return counter
    })
  }
}
