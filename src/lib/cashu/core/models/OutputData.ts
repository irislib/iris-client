import {OutputData, type SerializedBlindedMessage} from "@cashu/cashu-ts"

export interface PersistedOutputData {
  blindedMessage: SerializedBlindedMessage
  blindingFactor: string
  secret: string
}

export function persistOutputData(outputs: OutputData[]): PersistedOutputData[] {
  return outputs.map((output) => ({
    blindedMessage: {...output.blindedMessage},
    blindingFactor: output.blindingFactor.toString(),
    secret: Array.from(output.secret, (byte) => byte.toString(16).padStart(2, "0")).join(
      ""
    ),
  }))
}

export function hydrateOutputData(outputs: PersistedOutputData[]): OutputData[] {
  return outputs.map((output) => {
    if (output.secret.length % 2 || !/^[0-9a-f]*$/i.test(output.secret)) {
      throw new Error("Invalid persisted output secret")
    }
    return new OutputData(
      {...output.blindedMessage},
      BigInt(output.blindingFactor),
      Uint8Array.from(output.secret.match(/../g) ?? [], (byte) => parseInt(byte, 16))
    )
  })
}
