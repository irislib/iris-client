import type {Counter} from "../models/Counter"
import type {CounterRepository} from "../repositories"
import {EventBus} from "../events/EventBus"
import type {CoreEvents} from "../events/types"
import type {Logger} from "../logging/Logger.ts"
import {assertNonNegativeInteger} from "../utils.ts"

export class CounterService {
  private readonly counterRepo: CounterRepository
  private readonly eventBus?: EventBus<CoreEvents>
  private readonly logger?: Logger

  constructor(
    counterRepo: CounterRepository,
    logger?: Logger,
    eventBus?: EventBus<CoreEvents>
  ) {
    this.counterRepo = counterRepo
    this.logger = logger
    this.eventBus = eventBus
  }

  async getCounter(mintUrl: string, keysetId: string): Promise<Counter> {
    const counter = await this.counterRepo.getCounter(mintUrl, keysetId)
    return counter ?? {mintUrl, keysetId, counter: 0}
  }

  async reserveCounters(mintUrl: string, keysetId: string, count: number) {
    assertNonNegativeInteger("count", count, this.logger)
    const start = await this.counterRepo.reserveCounter(mintUrl, keysetId, count)
    const updated = {mintUrl, keysetId, counter: start + count}
    await this.eventBus?.emit("counter:updated", updated)
    this.logger?.info("Counters reserved", {
      mintUrl,
      keysetId,
      start,
      count,
    })
    return {start, end: updated.counter}
  }

  async advanceCounterToAtLeast(mintUrl: string, keysetId: string, minimum: number) {
    assertNonNegativeInteger("minimum", minimum, this.logger)
    const counter = await this.counterRepo.advanceCounter(mintUrl, keysetId, minimum)
    const updated = {mintUrl, keysetId, counter}
    await this.eventBus?.emit("counter:updated", updated)
    this.logger?.info("Counter advanced", {mintUrl, keysetId, counter})
    return updated
  }
}
