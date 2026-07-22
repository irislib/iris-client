import type {Mint} from "../models/Mint"
import type {Keyset} from "../models/Keyset"
import type {Counter} from "../models/Counter"
import type {CoreProof, ProofState} from "../types"
import type {MintQuote} from "@core/models/MintQuote"
import type {MeltQuote} from "@core/models/MeltQuote"
import type {HistoryEntry, MeltHistoryEntry, MintHistoryEntry} from "@core/models/History"

export interface MintRepository {
  isKnownMint(mintUrl: string): Promise<boolean>
  getMintByUrl(mintUrl: string): Promise<Mint>
  getAllMints(): Promise<Mint[]>
  addNewMint(mint: Mint): Promise<void>
  updateMint(mint: Mint): Promise<void>
  deleteMint(mintUrl: string): Promise<void>
}

export interface KeysetRepository {
  getKeysetsByMintUrl(mintUrl: string): Promise<Keyset[]>
  getKeysetById(mintUrl: string, id: string): Promise<Keyset | null>
  updateKeyset(keyset: Omit<Keyset, "keypairs" | "updatedAt">): Promise<void>
  addKeyset(keyset: Omit<Keyset, "updatedAt">): Promise<void>
  deleteKeyset(mintUrl: string, keysetId: string): Promise<void>
}

export interface CounterRepository {
  getCounter(mintUrl: string, keysetId: string): Promise<Counter | null>
  reserveCounter(mintUrl: string, keysetId: string, count: number): Promise<number>
  advanceCounter(mintUrl: string, keysetId: string, minimum: number): Promise<number>
}

export interface ProofRepository {
  saveProofs(mintUrl: string, proofs: CoreProof[]): Promise<void>
  getReadyProofs(mintUrl: string): Promise<CoreProof[]>
  getAllReadyProofs(): Promise<CoreProof[]>
  setProofState(mintUrl: string, secrets: string[], state: ProofState): Promise<void>
  deleteProofs(mintUrl: string, secrets: string[]): Promise<void>
  getProofsByKeysetId(mintUrl: string, keysetId: string): Promise<CoreProof[]>
  wipeProofsByKeysetId(mintUrl: string, keysetId: string): Promise<void>
}

export interface MintQuoteRepository {
  getMintQuote(mintUrl: string, quoteId: string): Promise<MintQuote | null>
  addMintQuote(quote: MintQuote): Promise<void>
  setMintQuoteState(
    mintUrl: string,
    quoteId: string,
    state: MintQuote["state"]
  ): Promise<void>
  getPendingMintQuotes(): Promise<MintQuote[]>
}

export interface MeltQuoteRepository {
  getMeltQuote(mintUrl: string, quoteId: string): Promise<MeltQuote | null>
  saveMeltQuote(quote: MeltQuote): Promise<void>
  getPendingMeltQuotes(): Promise<MeltQuote[]>
}

export interface HistoryRepository {
  getPaginatedHistoryEntries(limit: number, offset: number): Promise<HistoryEntry[]>
  addHistoryEntry(history: Omit<HistoryEntry, "id">): Promise<HistoryEntry>
  getMintHistoryEntry(mintUrl: string, quoteId: string): Promise<MintHistoryEntry | null>
  getMeltHistoryEntry(mintUrl: string, quoteId: string): Promise<MeltHistoryEntry | null>
  updateHistoryEntry(
    history: Omit<HistoryEntry, "id" | "createdAt">
  ): Promise<HistoryEntry>
  deleteHistoryEntry(mintUrl: string, quoteId: string): Promise<void>
}

export interface Repositories {
  init(): Promise<void>
  mintRepository: MintRepository
  counterRepository: CounterRepository
  keysetRepository: KeysetRepository
  proofRepository: ProofRepository
  mintQuoteRepository: MintQuoteRepository
  meltQuoteRepository: MeltQuoteRepository
  historyRepository: HistoryRepository
}

export * from "./memory"
