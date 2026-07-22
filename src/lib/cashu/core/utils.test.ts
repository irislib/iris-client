import {describe, expect, it} from "vitest"
import type {MintKeys} from "@cashu/cashu-ts"
import {createFeeAwareOutputPlan} from "./utils"

describe("createFeeAwareOutputPlan", () => {
  it("preserves denominations while grossing up non-monotonic input fees", () => {
    const keys: MintKeys = {
      id: "0011223344556677",
      unit: "sat",
      keys: Object.fromEntries(
        [1, 2, 4, 8, 16].map((amount) => [amount, `02${"22".repeat(32)}`])
      ),
    }
    const wallet = {getFeesForKeyset: (inputCount: number) => inputCount}

    const plan = createFeeAwareOutputPlan(13, keys, wallet as never)

    expect(plan).toEqual({amount: 17, denominations: [8, 4, 1, 4]})
    expect(plan.amount - wallet.getFeesForKeyset(plan.denominations.length)).toBe(13)
  })
})
