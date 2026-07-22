import {afterEach, describe, expect, it} from "vitest"
import type {MeltQuote} from "../../core"
import {IndexedDbRepositories} from ".."

const openDatabases: IndexedDbRepositories[] = []

afterEach(async () => {
  const [first, ...rest] = openDatabases.splice(0)
  rest.forEach(({db}) => db.close())
  if (first) await first.db.delete()
})

describe("IdbMeltQuoteRepository", () => {
  it("round-trips a restart-safe melt preview and only enumerates recoverable rows", async () => {
    const name = `cashu-melt-${crypto.randomUUID()}`
    const first = new IndexedDbRepositories({name})
    openDatabases.push(first)
    await first.init()
    const preview = {
      method: "bolt11",
      inputs: [
        {
          id: "keyset",
          amount: 8,
          secret: "input-secret",
          C: `02${"11".repeat(32)}`,
        },
      ],
      keysetId: "keyset",
      outputData: [
        {
          blindedMessage: {
            amount: 0,
            B_: `02${"22".repeat(32)}`,
            id: "keyset",
          },
          blindingFactor: "12345678901234567890",
          secret: "0001feff",
        },
      ],
    }
    const pending: MeltQuote = {
      mintUrl: "https://mint.example",
      quote: "pending",
      request: "lnbc1invoice",
      amount: 5,
      fee_reserve: 1,
      unit: "sat",
      state: "PENDING",
      expiry: 1_800_000_000,
      payment_preimage: null,
      meltPreview: preview,
    }
    await first.meltQuoteRepository.saveMeltQuote(pending)
    await first.meltQuoteRepository.saveMeltQuote({
      ...pending,
      quote: "unattempted",
      state: "UNPAID",
      meltPreview: null,
    })
    first.db.close()

    const reopened = new IndexedDbRepositories({name})
    openDatabases.push(reopened)
    await reopened.init()

    await expect(
      reopened.meltQuoteRepository.getMeltQuote(pending.mintUrl, pending.quote)
    ).resolves.toEqual(pending)
    await expect(reopened.meltQuoteRepository.getPendingMeltQuotes()).resolves.toEqual([
      pending,
    ])
    expect(() => JSON.stringify(pending.meltPreview)).not.toThrow()
  })
})
