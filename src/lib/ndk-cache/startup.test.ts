import {afterEach, describe, expect, it, vi} from "vitest"
import NDK, {NDKEvent, NDKSubscription} from "@/lib/ndk"
import NDKCacheAdapterDexie from "./index"
import {Database, db} from "./db"
import * as profiles from "./caches/profiles"
import * as events from "./caches/events"
import * as eventTags from "./caches/event-tags"
import {unpublishedEventsWarmUp} from "./caches/unpublished-events"

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return {promise, resolve}
}

const cleanup: (() => Promise<void>)[] = []

afterEach(async () => {
  for (const finish of cleanup.splice(0)) await finish()
  vi.restoreAllMocks()
})

async function createAdapter() {
  const database = new Database(`cache-startup-${crypto.randomUUID()}`)
  const event = new NDKEvent(undefined, {
    id: "a".repeat(64),
    pubkey: "b".repeat(64),
    kind: 1,
    created_at: 1,
    content: "cached note",
    tags: [["t", "nostr"]],
  })
  await database.events.put({
    id: event.id,
    pubkey: event.pubkey,
    kind: event.kind,
    createdAt: event.created_at!,
    event: event.serialize(false, true),
  })
  await database.eventTags.put({tagValue: "tnostr", eventId: event.id})
  database.close()

  const adapter = new NDKCacheAdapterDexie({dbName: database.name})
  const ready = new Promise<void>((resolve) => adapter.onReady(resolve))
  cleanup.push(async () => {
    await ready
    await db.delete()
  })
  const ndk = new NDK({explicitRelayUrls: []})
  ndk.cacheAdapter = adapter
  return {adapter, ndk, event, ready}
}

describe("cache startup", () => {
  it("starts relays after cached events arrive while unrelated warmups are still pending", async () => {
    const background = deferred()
    const eventRead = deferred()
    const warmEvents = events.eventsWarmUp
    vi.spyOn(profiles, "profilesWarmUp").mockReturnValue(background.promise)
    vi.spyOn(eventTags, "eventTagsWarmUp").mockReturnValue(background.promise)
    vi.spyOn(events, "eventsWarmUp").mockImplementation(async (...args) => {
      await eventRead.promise
      await warmEvents(...args)
    })
    cleanup.push(async () => {
      eventRead.resolve()
      background.resolve()
    })
    const {adapter, ndk, event} = await createAdapter()
    const subscription = new NDKSubscription(
      ndk,
      {authors: [event.pubkey], kinds: [1], "#t": ["nostr"]},
      {waitForCacheBeforeRelays: true}
    )
    const received: string[] = []
    subscription.on("event", (cached) => received.push(cached.id))
    const startRelays = vi
      .spyOn(
        subscription as unknown as {startWithRelays: () => void},
        "startWithRelays"
      )
      .mockImplementation(() => {
        expect(received).toEqual([event.id])
      })

    subscription.start()
    expect(startRelays).not.toHaveBeenCalled()
    eventRead.resolve()
    await vi.waitFor(() => expect(startRelays).toHaveBeenCalledOnce(), {
      timeout: 200,
      interval: 1,
    })
    expect(adapter.ready).toBe(false)
    subscription.stop()
  })

  it("waits for the tag index when a query needs it, without waiting for profiles", async () => {
    const background = deferred()
    const tagRead = deferred()
    const warmTags = eventTags.eventTagsWarmUp
    vi.spyOn(profiles, "profilesWarmUp").mockReturnValue(background.promise)
    vi.spyOn(eventTags, "eventTagsWarmUp").mockImplementation(async (...args) => {
      await tagRead.promise
      await warmTags(...args)
    })
    cleanup.push(async () => {
      tagRead.resolve()
      background.resolve()
    })
    const {adapter, ndk, event} = await createAdapter()
    const subscription = new NDKSubscription(ndk, {"#t": ["nostr"]})
    const receive = vi.spyOn(subscription, "eventReceived")
    let completed = false
    const query = adapter.query(subscription).then(() => {
      completed = true
    })

    await vi.waitFor(() => expect(adapter.events.get(event.id)).toBeTruthy())
    expect(completed).toBe(false)
    expect(receive).not.toHaveBeenCalled()
    tagRead.resolve()
    await vi.waitFor(() => expect(completed).toBe(true), {timeout: 200, interval: 1})
    await query
    expect(receive).toHaveBeenCalledOnce()
    expect(receive.mock.calls[0][0].id).toBe(event.id)
    expect(adapter.ready).toBe(false)
  })

  it("allows relay fallback when the event cache cannot be read", async () => {
    const background = deferred()
    vi.spyOn(profiles, "profilesWarmUp").mockReturnValue(background.promise)
    vi.spyOn(events, "eventsWarmUp").mockRejectedValue(new Error("cache unavailable"))
    cleanup.push(async () => background.resolve())
    const {adapter, ndk} = await createAdapter()
    const subscription = new NDKSubscription(
      ndk,
      {kinds: [1]},
      {waitForCacheBeforeRelays: true}
    )
    const startRelays = vi
      .spyOn(
        subscription as unknown as {startWithRelays: () => void},
        "startWithRelays"
      )
      .mockImplementation(() => undefined)

    subscription.start()
    await vi.waitFor(() => expect(startRelays).toHaveBeenCalledOnce(), {
      timeout: 200,
      interval: 1,
    })
    expect(adapter.ready).toBe(false)
    subscription.stop()
  })

  it("loads only the unpublished events that fit in memory with a bulk read", async () => {
    const {adapter, event, ready} = await createAdapter()
    await ready
    await db.unpublishedEvents.bulkPut(
      Array.from({length: 6}, (_, index) => ({
        id: String(index),
        event: {...event.rawEvent(), id: String(index)},
        relays: {},
      }))
    )
    adapter.unpublishedEvents.maxSize = 2
    const cursorRead = vi.spyOn(db.unpublishedEvents, "each")

    await unpublishedEventsWarmUp(adapter.unpublishedEvents, db.unpublishedEvents)

    expect(adapter.unpublishedEvents.size()).toBe(2)
    expect(cursorRead).not.toHaveBeenCalled()
    // The durable retry queue must remain complete.
    expect(await adapter.getUnpublishedEvents()).toHaveLength(6)
  })
})
