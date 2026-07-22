import {
  OutputData,
  type MeltPreview,
  type MeltQuoteResponse,
  type Proof,
  type SerializedBlindedMessage,
} from "@cashu/cashu-ts"

export interface PersistedMeltOutputData {
  blindedMessage: SerializedBlindedMessage
  blindingFactor: string
  secret: string
}

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

const bytesToHex = (bytes: Uint8Array): string =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")

const hexToBytes = (hex: string): Uint8Array => {
  if (hex.length % 2 !== 0 || !/^[0-9a-f]*$/i.test(hex)) {
    throw new Error("Invalid persisted melt output secret")
  }
  return Uint8Array.from({length: hex.length / 2}, (_, index) =>
    Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16)
  )
}

export function persistMeltPreview(
  preview: MeltPreview<MeltQuoteResponse>
): PersistedMeltPreview {
  return {
    method: preview.method,
    inputs: preview.inputs.map((proof) => ({...proof})),
    keysetId: preview.keysetId,
    outputData: preview.outputData.map((output) => ({
      blindedMessage: {...output.blindedMessage},
      blindingFactor: output.blindingFactor.toString(),
      secret: bytesToHex(output.secret),
    })),
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
  return preview.outputData.map(
    (output) =>
      new OutputData(
        {...output.blindedMessage},
        BigInt(output.blindingFactor),
        hexToBytes(output.secret)
      )
  )
}
