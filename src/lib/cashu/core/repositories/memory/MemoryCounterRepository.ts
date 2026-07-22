import type {Counter} from "../../models/Counter"
import type {CounterRepository} from ".."

export class MemoryCounterRepository implements CounterRepository {
  private counters: Map<string, Counter> = new Map()

  private key(mintUrl: string, keysetId: string): string {
    return `${mintUrl}::${keysetId}`
  }

  async getCounter(mintUrl: string, keysetId: string): Promise<Counter | null> {
    return this.counters.get(this.key(mintUrl, keysetId)) ?? null
  }

  async reserveCounter(
    mintUrl: string,
    keysetId: string,
    count: number
  ): Promise<number> {
    const key = this.key(mintUrl, keysetId)
    const start = this.counters.get(key)?.counter ?? 0
    this.counters.set(key, {mintUrl, keysetId, counter: start + count})
    return start
  }

  async advanceCounter(
    mintUrl: string,
    keysetId: string,
    minimum: number
  ): Promise<number> {
    const key = this.key(mintUrl, keysetId)
    const counter = Math.max(this.counters.get(key)?.counter ?? 0, minimum)
    this.counters.set(key, {mintUrl, keysetId, counter})
    return counter
  }
}
