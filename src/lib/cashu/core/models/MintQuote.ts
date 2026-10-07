import type {MintQuoteResponse} from "@cashu/cashu-ts"
import type {PersistedOutputData} from "./OutputData"

export interface MintQuote extends MintQuoteResponse {
  mintUrl: string
  mintOutputs?: PersistedOutputData[]
  mintKeysetId?: string
}
