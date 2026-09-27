import {expect, it, vi} from "vitest"
import NDK, {NDKEvent, NDKRelay, NDKSubscription} from "../index"

it("keeps request boundaries isolated while ordinary subscriptions stay reactive", () => {
  const ndk = new NDK()
  const relay = new NDKRelay("wss://relay.example", undefined, ndk)
  const search = new NDKSubscription(ndk, {kinds: [1]}, {isolated: true})
  const feed = new NDKSubscription(ndk, {kinds: [1]})
  ndk.subManager.add(search)
  ndk.subManager.add(feed)
  const onSearch = vi.fn()
  const onFeed = vi.fn()
  search.on("event", onSearch)
  feed.on("event", onFeed)
  const event = new NDKEvent(ndk, {
    id: "old-hashtag-result", pubkey: "a".repeat(64), kind: 1,
    created_at: 100, content: "iris", tags: [],
  })
  ndk.subManager.dispatchEvent(event, relay, false, new Map([[feed.internalId, {}]]))
  expect(onSearch).not.toHaveBeenCalled()
  expect(onFeed).toHaveBeenCalledOnce()
  ndk.subManager.dispatchEvent(event, relay, false, new Map([[search.internalId, {}]]))
  expect(onSearch).toHaveBeenCalledOnce()
})
