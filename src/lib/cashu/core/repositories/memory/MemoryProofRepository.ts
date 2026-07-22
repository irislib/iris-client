import type {ProofRepository} from ".."
import type {CoreProof} from "../../types"

type ProofState = "inflight" | "ready" | "spent"

interface StoredProof extends CoreProof {}

export class MemoryProofRepository implements ProofRepository {
  private proofsByMint: Map<string, Map<string, StoredProof>> = new Map()

  private getMintMap(mintUrl: string): Map<string, StoredProof> {
    if (!this.proofsByMint.has(mintUrl)) {
      this.proofsByMint.set(mintUrl, new Map())
    }
    return this.proofsByMint.get(mintUrl)!
  }

  async saveProofs(mintUrl: string, proofs: CoreProof[]): Promise<void> {
    if (!proofs || proofs.length === 0) return
    const map = this.getMintMap(mintUrl)
    // Pre-check for any collisions and fail atomically
    for (const p of proofs) {
      if (map.has(p.secret)) {
        throw new Error(`Proof with secret already exists: ${p.secret}`)
      }
    }
    for (const p of proofs) {
      map.set(p.secret, {...p, mintUrl})
    }
  }

  async getReadyProofs(mintUrl: string): Promise<CoreProof[]> {
    const map = this.getMintMap(mintUrl)
    return Array.from(map.values())
      .filter((p) => p.state === "ready")
      .map((p) => p as CoreProof)
  }

  async getAllReadyProofs(): Promise<CoreProof[]> {
    const all: CoreProof[] = []
    for (const map of this.proofsByMint.values()) {
      for (const p of map.values()) {
        if (p.state === "ready") {
          all.push(p as CoreProof)
        }
      }
    }
    return all
  }

  async getProofsByKeysetId(mintUrl: string, keysetId: string): Promise<CoreProof[]> {
    const map = this.getMintMap(mintUrl)
    const results: CoreProof[] = []
    for (const p of map.values()) {
      if (p.id === keysetId) {
        results.push(p as CoreProof)
      }
    }
    return results
  }

  async setProofState(
    mintUrl: string,
    secrets: string[],
    state: ProofState
  ): Promise<void> {
    const map = this.getMintMap(mintUrl)
    for (const secret of secrets) {
      const p = map.get(secret)
      if (p) map.set(secret, {...p, state})
    }
  }

  async deleteProofs(mintUrl: string, secrets: string[]): Promise<void> {
    const map = this.getMintMap(mintUrl)
    for (const s of secrets) map.delete(s)
  }

  async wipeProofsByKeysetId(mintUrl: string, keysetId: string): Promise<void> {
    const map = this.getMintMap(mintUrl)
    for (const [secret, p] of Array.from(map.entries())) {
      if (p.id === keysetId) {
        map.delete(secret)
      }
    }
  }
}
