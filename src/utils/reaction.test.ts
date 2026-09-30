import NostrClient, {AppEvent, PublishError} from "@/lib/nostr"
import {beforeEach, describe, expect, it, vi} from "vitest"
import {nostr} from "@/utils/nostrClient"
import {publishGroupEvent} from "@/groups/publish"
import {groupTags} from "@/groups/model"
import {
  getReactionPublishErrorMessage,
  isRelayPublishFailure,
  reactWithExpiration,
} from "./reaction"

vi.mock("@/utils/nostrClient", () => ({
  nostr: vi.fn(),
}))
vi.mock("@/groups/publish", () => ({publishGroupEvent: vi.fn()}))

const createTargetEvent = (eventNdk?: NostrClient) =>
  new AppEvent(eventNdk, {
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
    vi.clearAllMocks()
  })

  it("uses the app NostrClient when a cached target event has no attached instance", async () => {
    const appNdk = new NostrClient()
    vi.spyOn(appNdk, "assertSigner").mockImplementation(() => undefined)
    vi.mocked(nostr).mockReturnValue(appNdk)
    vi.spyOn(AppEvent.prototype, "publish").mockResolvedValue(new Set())

    const reaction = await reactWithExpiration(createTargetEvent(), "+")

    expect(nostr).toHaveBeenCalledOnce()
    expect(reaction.nostr).toBe(appNdk)
    expect(reaction.tags).toContainEqual(["expiration", "1_800_000_000"])
    expect(reaction.publish).toHaveBeenCalledOnce()
  })

  it("keeps using an attached NostrClient when the target already has one", async () => {
    const attachedNdk = new NostrClient()
    vi.spyOn(attachedNdk, "assertSigner").mockImplementation(() => undefined)
    vi.spyOn(AppEvent.prototype, "publish").mockResolvedValue(new Set())

    const reaction = await reactWithExpiration(createTargetEvent(attachedNdk), "+")

    expect(nostr).not.toHaveBeenCalled()
    expect(reaction.nostr).toBe(attachedNdk)
  })

  it("preserves group and custom emoji tags and propagates missing relay acknowledgment", async () => {
    const attachedNdk = new NostrClient()
    vi.spyOn(attachedNdk, "assertSigner").mockImplementation(() => undefined)
    const publish = vi.spyOn(AppEvent.prototype, "publish").mockResolvedValue(new Set())
    const event = createTargetEvent(attachedNdk)
    const tags = groupTags({
      creator: "a".repeat(64),
      id: "00000000-0000-4000-8000-000000000001",
    })
    event.tags.push(...tags)
    vi.mocked(publishGroupEvent).mockRejectedValueOnce(new Error("No relay acknowledged"))
    await expect(
      reactWithExpiration(event, ":wave:", [
        ["emoji", "wave", "https://example.com/wave.png"],
      ])
    ).rejects.toThrow("No relay acknowledged")
    const reaction = vi.mocked(publishGroupEvent).mock.calls[0][0] as AppEvent
    expect(reaction.tags).toEqual(
      expect.arrayContaining([...tags, ["emoji", "wave", "https://example.com/wave.png"]])
    )
    expect(publish).not.toHaveBeenCalled()
  })
})

describe("isRelayPublishFailure", () => {
  it("identifies relay delivery failures that should remain silent", () => {
    const error = new PublishError(
      "Not enough relays received the event (0 published, 1 required)",
      new Map(),
      new Set()
    )

    expect(isRelayPublishFailure(error)).toBe(true)
    expect(getReactionPublishErrorMessage(error)).toBeNull()
  })

  it("does not hide signer or runtime failures", () => {
    expect(isRelayPublishFailure(new Error("User rejected signing"))).toBe(false)
    expect(isRelayPublishFailure(new Error("No NostrClient instance found"))).toBe(false)
    expect(getReactionPublishErrorMessage(new Error("User rejected signing"))).toBe(
      "Could not publish reaction: User rejected signing"
    )
  })
})
