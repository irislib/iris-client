// @vitest-environment jsdom
import {beforeEach, describe, expect, it, vi} from "vitest"
import {verifyEvent} from "nostr-tools"
import NostrClient, {AppEvent, SecretKeySigner, Relay, RelaySet} from "@/lib/nostr"
import {useSettingsStore} from "@/stores/settings"
import {irisClientTagOptions} from "./clientTag"

const signer = SecretKeySigner.generate()

function createEvent(kind: number, tags: string[][] = []) {
  return new AppEvent(new NostrClient(irisClientTagOptions), {
    kind,
    content: "test",
    tags,
  })
}

describe("Iris client attribution through event signing", () => {
  beforeEach(() => {
    useSettingsStore.getState().updateContent({showClientTag: true})
  })

  it.each([1, 6, 7, 16, 20, 1111, 9734, 30023, 30402])(
    "signs public activity kind %i with one standard lowercase tag",
    async (kind) => {
      const event = createEvent(kind)
      await event.sign(signer)
      await event.sign(signer)
      expect(event.getMatchingTags("client")).toEqual([["client", "iris"]])
      expect(verifyEvent(event.rawEvent())).toBe(true)
    }
  )

  it.each([
    0, 3, 4, 5, 13, 14, 40, 42, 1059, 1060, 7375, 9735, 10000, 10002, 17375, 22242, 23194,
    24133, 27235, 30078, 31234, 99999,
  ])("keeps private, account, and unselected kind %i untagged", async (kind) => {
    const event = createEvent(kind, [["client", "inherited"]])
    await event.sign(signer)
    expect(event.getMatchingTags("client")).toEqual([])
    expect(verifyEvent(event.rawEvent())).toBe(true)
  })

  it("does not attribute anonymous or private zap requests", async () => {
    for (const anonTag of [["anon"], ["anon", "encrypted-zap"]]) {
      const event = createEvent(9734, [anonTag])
      await event.sign(signer)
      expect(event.getMatchingTags("client")).toEqual([])
    }
  })

  it("reads the current opt-out when signing, including inherited attribution", async () => {
    const event = createEvent(7, [["client", "another-app"]])
    useSettingsStore.getState().updateContent({showClientTag: false})
    await event.sign(signer)
    expect(event.getMatchingTags("client")).toEqual([])
    useSettingsStore.getState().updateContent({showClientTag: true})
    await event.sign(signer)
    expect(event.getMatchingTags("client")).toEqual([["client", "iris"]])
  })

  it("defaults old settings to on without overwriting an explicit opt-out", async () => {
    for (const [content, expected] of [
      [{blurNSFW: false}, true],
      [{showClientTag: false}, false],
    ] as const) {
      localStorage.setItem(
        "settings-storage",
        JSON.stringify({state: {content}, version: 0})
      )
      await useSettingsStore.persist.rehydrate()
      expect(useSettingsStore.getState().content.showClientTag).toBe(expected)
    }
  })

  it("preserves another client's signed event when rebroadcasting", async () => {
    const event = new AppEvent(new NostrClient({clientName: "other-client"}), {
      kind: 1,
      content: "original",
    })
    await event.sign(signer)
    const original = JSON.stringify(event.rawEvent())
    const appNdk = new NostrClient(irisClientTagOptions)
    event.nostr = appNdk
    const relay = new Relay("wss://relay.example", undefined, appNdk)
    const relaySet = new RelaySet(new Set([relay]), appNdk)
    vi.spyOn(relaySet, "publish").mockResolvedValue(new Set([relay]))
    await event.publish(relaySet)
    expect(JSON.stringify(event.rawEvent())).toBe(original)
    expect(verifyEvent(event.rawEvent())).toBe(true)
  })
})
