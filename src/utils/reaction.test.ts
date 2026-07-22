import NDK, {NDKEvent, NDKPublishError} from "@/lib/ndk"
import {beforeEach, describe, expect, it, vi} from "vitest"
import {ndk} from "./ndk"
import {
  getReactionPublishErrorMessage,
  isRelayPublishFailure,
  reactWithExpiration,
} from "./reaction"

vi.mock("./ndk", () => ({
  ndk: vi.fn(),
}))

const createTargetEvent = (eventNdk?: NDK) =>
  new NDKEvent(eventNdk, {
    id: "1".repeat(64),
    pubkey: "2".repeat(64),
    created_at: 1_700_000_000,
    kind: 1,
    tags: [["expiration", "1_800_000_000"]],
    content: "cached note",
    sig: "3".repeat(128),
  })

describe("reactWithExpiration", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it("uses the app NDK when a cached target event has no attached instance", async () => {
    const appNdk = new NDK()
    vi.spyOn(appNdk, "assertSigner").mockImplementation(() => undefined)
    vi.mocked(ndk).mockReturnValue(appNdk)
    vi.spyOn(NDKEvent.prototype, "publish").mockResolvedValue(new Set())

    const reaction = await reactWithExpiration(createTargetEvent(), "+")

    expect(ndk).toHaveBeenCalledOnce()
    expect(reaction.ndk).toBe(appNdk)
    expect(reaction.tags).toContainEqual(["expiration", "1_800_000_000"])
    expect(reaction.publish).toHaveBeenCalledOnce()
  })

  it("keeps using an attached NDK when the target already has one", async () => {
    const attachedNdk = new NDK()
    vi.spyOn(attachedNdk, "assertSigner").mockImplementation(() => undefined)
    vi.spyOn(NDKEvent.prototype, "publish").mockResolvedValue(new Set())

    const reaction = await reactWithExpiration(createTargetEvent(attachedNdk), "+")

    expect(ndk).not.toHaveBeenCalled()
    expect(reaction.ndk).toBe(attachedNdk)
  })
})

describe("isRelayPublishFailure", () => {
  it("identifies relay delivery failures that should remain silent", () => {
    const error = new NDKPublishError(
      "Not enough relays received the event (0 published, 1 required)",
      new Map(),
      new Set()
    )

    expect(isRelayPublishFailure(error)).toBe(true)
    expect(getReactionPublishErrorMessage(error)).toBeNull()
  })

  it("does not hide signer or runtime failures", () => {
    expect(isRelayPublishFailure(new Error("User rejected signing"))).toBe(false)
    expect(isRelayPublishFailure(new Error("No NDK instance found"))).toBe(false)
    expect(getReactionPublishErrorMessage(new Error("User rejected signing"))).toBe(
      "Could not publish reaction: User rejected signing"
    )
  })
})
