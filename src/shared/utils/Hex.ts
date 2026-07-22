import {hexToBytes} from "@noble/hashes/utils.js"
import {nip19} from "nostr-tools"

/**
 * Hex encoded string.
 */
export class Hex {
  value: string

  /**
   * @throws Error if the provided string is not a valid hex value or does not match the expected length
   */
  constructor(str: string, expectedLength?: number) {
    // maybe should accept bech32 input and convert to hex?
    this.validateHex(str, expectedLength)
    this.value = str
  }

  private validateHex(str: string, expectedLength?: number): void {
    if (!/^[0-9a-fA-F]+$/.test(str)) {
      throw new Error(`The provided string is not a valid hex value: "${str}"`)
    }

    if (expectedLength && str.length !== expectedLength) {
      throw new Error(
        `The provided hex value does not match the expected length of ${expectedLength} characters: ${str}`
      )
    }
  }

  toBech32(prefix: string): string {
    if (!prefix) {
      throw new Error("prefix is required")
    }

    const data = hexToBytes(this.value)

    return nip19.encodeBytes(prefix, data)
  }

  get hex(): string {
    return this.value
  }

  toString(): string {
    return this.value
  }
}
