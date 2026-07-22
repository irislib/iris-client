import type {MeltQuoteState, MintQuoteState, Token} from "@cashu/cashu-ts"

type BaseHistoryEntry = {
  id: string
  createdAt: number
  mintUrl: string
  unit: string
  metadata?: Record<string, string>
}

export type MintHistoryEntry = BaseHistoryEntry & {
  type: "mint"
  paymentRequest: string
  quoteId: string
  state: MintQuoteState
  amount: number
}

export type MeltHistoryEntry = BaseHistoryEntry & {
  type: "melt"
  quoteId: string
  state: MeltQuoteState
  amount: number
}

export type SendHistoryEntry = BaseHistoryEntry & {
  type: "send"
  amount: number
  token: Token
}

export type ReceiveHistoryEntry = BaseHistoryEntry & {
  type: "receive"
  amount: number
  token?: Token
}

export type HistoryEntry =
  MintHistoryEntry | MeltHistoryEntry | SendHistoryEntry | ReceiveHistoryEntry
