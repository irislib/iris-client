import {describe, expect, it} from "vitest"
import {profileEditorValues, readProfileMetadata} from "./profileMetadata"

const pubkey = "1".repeat(64)
const envelope = (content: unknown, author = pubkey, kind = 0) =>
  JSON.stringify({
    pubkey: author,
    kind,
    created_at: 123,
    content: JSON.stringify(content),
  })

describe("profile editor source metadata", () => {
  it("retains arbitrary JSON and metadata names that overlap cache fields", () => {
    const metadata = {
      name: "Original name",
      bot: true,
      extra: {tags: ["one", null, 3], active: false},
      pubkey: "custom public field",
      created_at: 7,
      cachedAt: 9,
      profileEvent: "custom extension value",
    }
    expect(readProfileMetadata(envelope(metadata), pubkey)).toEqual({
      metadata,
      createdAt: 123,
    })
  })

  it("rejects incomplete or mismatched sources instead of supplying an empty profile", () => {
    for (const source of [
      undefined,
      "invalid JSON",
      envelope(null),
      envelope([]),
      envelope({name: "Other user"}, "2".repeat(64)),
      envelope({name: "Wrong kind"}, pubkey, 1),
      JSON.stringify({pubkey, kind: 0, content: {name: "Not serialized"}}),
    ]) {
      expect(readProfileMetadata(source, pubkey)).toBeNull()
    }
  })

  it("projects editable values without changing source fields or undoing explicit clears", () => {
    const metadata = {
      name: "Legacy name",
      bio: "Legacy bio",
      image: "https://example.com/old.png",
      picture: "",
      custom: [1, 2, 3],
    }
    expect(profileEditorValues(metadata)).toMatchObject({
      display_name: "Legacy name",
      about: "Legacy bio",
      picture: "",
    })
    expect(metadata).not.toHaveProperty("display_name")
    expect(metadata.custom).toEqual([1, 2, 3])
  })
})
