import {describe, expect, it} from "vitest"

async function importPortableSmokeModule(): Promise<{
  shouldIgnorePageError: (text: string) => boolean
}> {
  // @ts-expect-error local node script is imported dynamically for runtime config testing
  return (await import("../scripts/portable-smoke-lib.mjs")) as {
    shouldIgnorePageError: (text: string) => boolean
  }
}

describe("portable smoke page errors", () => {
  it("ignores benign browser media play/pause interruptions", async () => {
    const {shouldIgnorePageError} = await importPortableSmokeModule()

    expect(
      shouldIgnorePageError(
        "The play() request was interrupted by a call to pause(). https://goo.gl/LdLk22"
      )
    ).toBe(true)
  })

  it("keeps real page errors fatal", async () => {
    const {shouldIgnorePageError} = await importPortableSmokeModule()

    expect(shouldIgnorePageError("TypeError: Cannot read properties of undefined")).toBe(
      false
    )
  })
})
