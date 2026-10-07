import {
  type OutputData,
  type MeltPreview,
  type MeltQuoteResponse,
  type Proof,
} from "@cashu/cashu-ts"

import {
  hydrateOutputData,
  persistOutputData,
  type PersistedOutputData,
} from "./OutputData"
export type PersistedMeltOutputData = PersistedOutputData

export interface PersistedMeltPreview {
  method: string
  inputs: Proof[]
  outputData: PersistedMeltOutputData[]
  keysetId: string
}

export interface MeltQuote extends MeltQuoteResponse {
  mintUrl: string
  meltPreview?: PersistedMeltPreview | null
}

export function persistMeltPreview(
  preview: MeltPreview<MeltQuoteResponse>
): PersistedMeltPreview {
  return {
    method: preview.method,
    inputs: preview.inputs.map((proof) => ({...proof})),
    keysetId: preview.keysetId,
    outputData: persistOutputData(preview.outputData),
  }
}

export function hydrateMeltPreview(
  preview: PersistedMeltPreview,
  quote: MeltQuoteResponse
): MeltPreview<MeltQuoteResponse> {
  return {
    method: preview.method,
    inputs: preview.inputs.map((proof) => ({...proof})),
    keysetId: preview.keysetId,
    quote,
    outputData: hydrateMeltOutputData(preview),
  }
}

export function hydrateMeltOutputData(preview: PersistedMeltPreview): OutputData[] {
  return hydrateOutputData(preview.outputData)
}
