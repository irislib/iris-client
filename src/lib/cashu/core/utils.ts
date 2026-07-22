import {
  hashToCurve,
  splitAmount,
  type MintKeys,
  type Proof,
  type Wallet,
} from "@cashu/cashu-ts"
import type {CoreProof, ProofState} from "./types"
import type {Logger} from "./logging/Logger.ts"

export function mapProofToCoreProof(
  mintUrl: string,
  state: ProofState,
  proofs: Proof[]
): CoreProof[] {
  return proofs.map((p) => ({
    ...p,
    mintUrl,
    state,
  }))
}

export function assertNonNegativeInteger(
  paramName: string,
  value: number,
  logger?: Logger
): void {
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < 0) {
    logger?.warn("Invalid numeric value", {[paramName]: value})
    throw new Error(`${paramName} must be a non-negative integer`)
  }
}

export function createFeeAwareOutputPlan(
  netAmount: number,
  keys: MintKeys,
  wallet: Pick<Wallet, "getFeesForKeyset">
): {amount: number; denominations: number[]} {
  const denominations = splitAmount(netAmount, keys.keys)
  let fee = wallet.getFeesForKeyset(denominations.length, keys.id)
  let feeDenominations = fee > 0 ? splitAmount(fee, keys.keys) : []

  while (
    wallet.getFeesForKeyset(denominations.length + feeDenominations.length, keys.id) > fee
  ) {
    fee += 1
    feeDenominations = splitAmount(fee, keys.keys)
  }

  return {amount: netAmount + fee, denominations: [...denominations, ...feeDenominations]}
}

export function toBase64Url(bytes: Uint8Array): string {
  let base64: string | undefined
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const Buf = (globalThis as any).Buffer
  if (typeof Buf !== "undefined") {
    base64 = Buf.from(bytes).toString("base64")
  } else if (typeof btoa !== "undefined") {
    let bin = ""
    for (const b of bytes) bin += String.fromCharCode(b)
    base64 = btoa(bin)
  }
  if (!base64) {
    return Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
  }
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

export function generateSubId(): string {
  const length = 16
  const bytes = new Uint8Array(length)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cryptoObj: any = (globalThis as any).crypto
  if (cryptoObj && typeof cryptoObj.getRandomValues === "function") {
    cryptoObj.getRandomValues(bytes)
  } else {
    for (let i = 0; i < length; i++) bytes[i] = Math.floor(Math.random() * 256)
  }
  return toBase64Url(bytes)
}

/**
 * Compute the Y point (hex, compressed) for a single secret using hash-to-curve.
 */
export function computeYHexForSecrets(secrets: string[]): string[] {
  const encoder = new TextEncoder()
  return secrets.map((secret) => hashToCurve(encoder.encode(secret)).toHex(true))
}

/**
 * Build bidirectional maps between secrets and their Y points (hex) using hash-to-curve.
 * - yHexBySecret: secret -> Y hex
 * - secretByYHex: Y hex -> secret
 */
export function buildYHexMapsForSecrets(secrets: string[]): {
  yHexBySecret: Map<string, string>
  secretByYHex: Map<string, string>
} {
  const yHexBySecret = new Map<string, string>()
  const secretByYHex = new Map<string, string>()
  const yHexes = computeYHexForSecrets(secrets)
  for (let i = 0; i < secrets.length; i++) {
    const secret = secrets[i]
    const yHex = yHexes[i]
    if (!secret || !yHex) continue
    yHexBySecret.set(secret, yHex)
    secretByYHex.set(yHex, secret)
  }
  return {yHexBySecret, secretByYHex}
}
