import type {Mint} from "../models/Mint"
import type {Keyset} from "../models/Keyset"
import type {Counter} from "../models/Counter"
import type {
  MeltQuoteResponse,
  MeltQuoteState,
  MintQuoteResponse,
  MintQuoteState,
  Token,
} from "@cashu/cashu-ts"
import type {CoreProof, ProofState} from "../types"
import type {HistoryEntry} from "../models/History"

export interface CoreEvents {
  "mint:added": {mint: Mint; keysets: Keyset[]}
  "mint:updated": {mint: Mint; keysets: Keyset[]}
  "counter:updated": Counter
  "proofs:saved": {mintUrl: string; keysetId: string; proofs: CoreProof[]}
  "proofs:state-changed": {
    mintUrl: string
    secrets: string[]
    state: ProofState
  }
  "proofs:deleted": {mintUrl: string; secrets: string[]}
  "proofs:wiped": {mintUrl: string; keysetId: string}
  "mint-quote:state-changed": {mintUrl: string; quoteId: string; state: MintQuoteState}
  "mint-quote:created": {mintUrl: string; quoteId: string; quote: MintQuoteResponse}
  "mint-quote:added": {
    mintUrl: string
    quoteId: string
    quote: MintQuoteResponse
  }
  "mint-quote:requeue": {mintUrl: string; quoteId: string}
  "mint-quote:redeemed": {mintUrl: string; quoteId: string; quote: MintQuoteResponse}
  "melt-quote:created": {mintUrl: string; quoteId: string; quote: MeltQuoteResponse}
  "melt-quote:state-changed": {mintUrl: string; quoteId: string; state: MeltQuoteState}
  "melt-quote:paid": {mintUrl: string; quoteId: string; quote: MeltQuoteResponse}
  "send:created": {mintUrl: string; token: Token; amount: number}
  "receive:created": {mintUrl: string; token: Token; amount: number}
  "history:updated": {mintUrl: string; entry: HistoryEntry}
}
