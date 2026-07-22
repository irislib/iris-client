export interface Keyset {
  mintUrl: string
  id: string
  unit: string
  keypairs: Record<number, string> // JSON string
  active: boolean
  feePpk: number
  finalExpiry?: number
  updatedAt: number
}
