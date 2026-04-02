import {describe, expect, it} from "vitest"
import {noteCreatorDraftPayload} from "./useNoteDraft"

describe("noteCreatorDraftPayload", () => {
  it("does not overwrite note creator defaults with undefined optional draft fields", () => {
    const payload = noteCreatorDraftPayload({
      content: "hello",
      imeta: [],
      expirationDelta: undefined,
      eventKind: undefined,
      price: undefined,
      title: undefined,
    })

    expect(payload).toEqual({
      text: "hello",
      imeta: [],
    })
    expect("eventKind" in payload).toBe(false)
    expect("price" in payload).toBe(false)
    expect("title" in payload).toBe(false)
    expect("expirationDelta" in payload).toBe(false)
  })

  it("preserves defined optional draft fields", () => {
    const payload = noteCreatorDraftPayload({
      content: "market post",
      imeta: [{url: "https://example.com/file.jpg"}],
      expirationDelta: null,
      eventKind: 30402,
      price: {amount: "12", currency: "USD", frequency: "monthly"},
      title: "Listing",
    })

    expect(payload).toEqual({
      text: "market post",
      imeta: [{url: "https://example.com/file.jpg"}],
      expirationDelta: null,
      eventKind: 30402,
      price: {amount: "12", currency: "USD", frequency: "monthly"},
      title: "Listing",
    })
  })
})
