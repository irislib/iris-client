import type {
  Repositories,
  MintRepository,
  KeysetRepository,
  CounterRepository,
  ProofRepository,
  MintQuoteRepository,
  MeltQuoteRepository,
  HistoryRepository,
} from ".."
import {MemoryMintRepository} from "./MemoryMintRepository"
import {MemoryKeysetRepository} from "./MemoryKeysetRepository"
import {MemoryCounterRepository} from "./MemoryCounterRepository"
import {MemoryProofRepository} from "./MemoryProofRepository"
import {MemoryMintQuoteRepository} from "./MemoryMintQuoteRepository"
import {MemoryMeltQuoteRepository} from "./MemoryMeltQuoteRepository"
import {MemoryHistoryRepository} from "./MemoryHistoryRepository"

export class MemoryRepositories implements Repositories {
  mintRepository: MintRepository
  counterRepository: CounterRepository
  keysetRepository: KeysetRepository
  proofRepository: ProofRepository
  mintQuoteRepository: MintQuoteRepository
  meltQuoteRepository: MeltQuoteRepository
  historyRepository: HistoryRepository

  constructor() {
    this.mintRepository = new MemoryMintRepository()
    this.counterRepository = new MemoryCounterRepository()
    this.keysetRepository = new MemoryKeysetRepository()
    this.proofRepository = new MemoryProofRepository()
    this.mintQuoteRepository = new MemoryMintQuoteRepository()
    this.meltQuoteRepository = new MemoryMeltQuoteRepository()
    this.historyRepository = new MemoryHistoryRepository()
  }

  async init(): Promise<void> {
    // No-op: Memory repositories don't require initialization
  }
}
