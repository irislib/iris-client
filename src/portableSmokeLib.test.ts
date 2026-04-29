import {describe, expect, it} from "vitest"

async function importPortableSmokeModule(): Promise<{
  isTopLevelDocumentResponse: (page: unknown, response: unknown) => boolean
  shouldIgnoreConsoleError: (text: string) => boolean
  shouldIgnorePageError: (text: string) => boolean
}> {
  // @ts-expect-error local node script is imported dynamically for runtime config testing
  return (await import("../scripts/portable-smoke-lib.mjs")) as {
    isTopLevelDocumentResponse: (page: unknown, response: unknown) => boolean
    shouldIgnoreConsoleError: (text: string) => boolean
    shouldIgnorePageError: (text: string) => boolean
  }
}

describe("portable smoke document responses", () => {
  it("counts only main-frame document responses as reloads", async () => {
    const {isTopLevelDocumentResponse} = await importPortableSmokeModule()
    const mainFrame = {}
    const childFrame = {}
    const page = {mainFrame: () => mainFrame}

    const makeResponse = (resourceType: string, frame: unknown) => ({
      request: () => ({
        resourceType: () => resourceType,
        frame: () => frame,
      }),
    })

    expect(isTopLevelDocumentResponse(page, makeResponse("document", mainFrame))).toBe(
      true
    )
    expect(isTopLevelDocumentResponse(page, makeResponse("document", childFrame))).toBe(
      false
    )
    expect(isTopLevelDocumentResponse(page, makeResponse("script", mainFrame))).toBe(
      false
    )
  })
})

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

describe("portable smoke console errors", () => {
  it("ignores browser permission-policy noise from embedded media", async () => {
    const {shouldIgnoreConsoleError} = await importPortableSmokeModule()

    expect(
      shouldIgnoreConsoleError(
        "Permissions policy violation: picture-in-picture is not allowed in this document."
      )
    ).toBe(true)
  })

  it("keeps real console errors fatal", async () => {
    const {shouldIgnoreConsoleError} = await importPortableSmokeModule()

    expect(shouldIgnoreConsoleError("Uncaught TypeError: boom")).toBe(false)
  })
})
