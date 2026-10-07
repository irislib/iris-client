import {expect, it} from "vitest"
import {IndexedDbRepositories} from ".."
import type {MintQuote} from "../../core"

it("preserves mint recovery outputs across database reopen and issuance observations", async () => {
  const name = `mint-recovery-${crypto.randomUUID()}`
  const first = new IndexedDbRepositories({name})
  const reopened = new IndexedDbRepositories({name})
  try {
    await first.init()
    const quote: MintQuote = {
      mintUrl: "https://mint.example",
      quote: "incoming",
      request: "lnbc1invoice",
      state: "PAID",
      amount: 8,
      unit: "sat",
      expiry: 1800000000,
      mintKeysetId: "keyset",
      mintOutputs: [
        {
          blindedMessage: {id: "keyset", amount: 8, B_: `02${"22".repeat(32)}`},
          blindingFactor: "12345678901234567890",
          secret: "0001feff",
        },
      ],
    }
    await first.mintQuoteRepository.addMintQuote(quote)
    await first.mintQuoteRepository.setMintQuoteState(
      quote.mintUrl,
      quote.quote,
      "ISSUED"
    )
    first.db.close()
    await reopened.init()
    await expect(reopened.mintQuoteRepository.getPendingMintQuotes()).resolves.toEqual([
      {...quote, state: "ISSUED"},
    ])
    await reopened.mintQuoteRepository.addMintQuote({
      ...quote,
      state: "ISSUED",
      mintOutputs: undefined,
      mintKeysetId: undefined,
    })
    await expect(reopened.mintQuoteRepository.getPendingMintQuotes()).resolves.toEqual([])
  } finally {
    first.db.close()
    await reopened.db.delete()
  }
})
