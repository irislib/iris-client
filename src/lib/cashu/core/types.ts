import type {Mint, Proof} from "@cashu/cashu-ts"

export type MintInfo = Awaited<ReturnType<Mint["getInfo"]>>

export type ProofState = "inflight" | "ready" | "spent"

export interface CoreProof extends Proof {
  mintUrl: string
  state: ProofState
}
