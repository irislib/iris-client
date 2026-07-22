export class UnknownMintError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "UnknownMintError"
  }
}

export class MintFetchError extends Error {
  readonly mintUrl: string
  constructor(mintUrl: string, message?: string, cause?: unknown) {
    super(message ?? `Failed to fetch mint ${mintUrl}`)
    this.name = "MintFetchError"
    this.mintUrl = mintUrl
    // Assign cause in a backwards compatible way without relying on ErrorOptions
    ;(this as unknown as {cause?: unknown}).cause = cause
  }
}

export class KeysetSyncError extends Error {
  readonly mintUrl: string
  readonly keysetId: string
  constructor(mintUrl: string, keysetId: string, message?: string, cause?: unknown) {
    super(message ?? `Failed to sync keyset ${keysetId} for mint ${mintUrl}`)
    this.name = "KeysetSyncError"
    this.mintUrl = mintUrl
    this.keysetId = keysetId
    ;(this as unknown as {cause?: unknown}).cause = cause
  }
}

export class ProofValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ProofValidationError"
  }
}

export class ProofOperationError extends Error {
  readonly mintUrl: string
  readonly keysetId?: string
  constructor(mintUrl: string, message?: string, keysetId?: string, cause?: unknown) {
    super(
      message ??
        `Proof operation failed for mint ${mintUrl}${keysetId ? ` keyset ${keysetId}` : ""}`
    )
    this.name = "ProofOperationError"
    this.mintUrl = mintUrl
    this.keysetId = keysetId
    ;(this as unknown as {cause?: unknown}).cause = cause
  }
}
