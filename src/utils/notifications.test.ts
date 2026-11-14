import {describe, expect, it, vi} from "vitest"
import {MESSAGE_EVENT_KIND} from "nostr-double-ratchet"
import {
  clearNotifications,
  createLatestNotificationSyncQueue,
  extractSessionPubkeysFromRuntime,
  planDmNotificationSync,
} from "./notifications"
import type {NotificationSubscriptionResponse} from "./IrisAPI"

const OUR_PUBKEY = "a".repeat(64)
const PEER_ONE = "b".repeat(64)
const PEER_TWO = "c".repeat(64)

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise
  })
  return {promise, resolve}
}

describe("notification synchronization queue", () => {
  it("applies the latest DM preference after an older mutation finishes", async () => {
    const oldMutation = deferred()
    const mutations: boolean[] = []
    let dmsEnabled = false
    const sync = vi.fn(async (enabled: boolean) => {
      mutations.push(enabled)
      if (enabled) await oldMutation.promise
      dmsEnabled = enabled
    })
    const queue = createLatestNotificationSyncQueue(sync)

    void queue(true)
    const settled = queue(false)

    expect(sync).toHaveBeenCalledTimes(1)
    expect(mutations).toEqual([true])

    oldMutation.resolve()
    await settled

    expect(mutations).toEqual([true, false])
    expect(dmsEnabled).toBe(false)
  })

  it("coalesces general notification changes behind an in-flight update", async () => {
    const oldMutation = deferred()
    const mutations: string[] = []
    let serverPreference = ""
    const sync = vi.fn(async (preference: string) => {
      mutations.push(preference)
      if (preference === "mentions") await oldMutation.promise
      serverPreference = preference
    })
    const queue = createLatestNotificationSyncQueue(sync)

    void queue("mentions")
    void queue("reactions")
    const settled = queue("zaps")

    expect(sync).toHaveBeenCalledTimes(1)
    expect(mutations).toEqual(["mentions"])

    oldMutation.resolve()
    await settled

    expect(mutations).toEqual(["mentions", "zaps"])
    expect(serverPreference).toBe("zaps")
  })
})

function createRuntimeWithPrivateAuthors() {
  return {
    getSessionUserRecords: () => new Map([[PEER_ONE, {devices: new Map()}]]) as any,
    getSessionMessagePushAuthorPubkeys: () => [OUR_PUBKEY, PEER_ONE, PEER_TWO],
  }
}

describe("extractSessionPubkeysFromRuntime", () => {
  it("excludes our own pubkey from extracted session authors", () => {
    const result = extractSessionPubkeysFromRuntime(
      createRuntimeWithPrivateAuthors(),
      OUR_PUBKEY
    )

    expect(result).toEqual([PEER_ONE, PEER_TWO])
  })

  it("includes all session pubkeys when our public key is unknown", () => {
    const result = extractSessionPubkeysFromRuntime(createRuntimeWithPrivateAuthors())

    expect(result).toEqual([OUR_PUBKEY, PEER_ONE, PEER_TWO])
  })
})

describe("planDmNotificationSync", () => {
  const endpoint = "https://push.example/subscription"
  const push = {endpoint, p256dh: "key", auth: "auth"}
  const subscriptions: NotificationSubscriptionResponse = {
    first: {
      filter: {kinds: [MESSAGE_EVENT_KIND], authors: [PEER_ONE]},
      subscriber: OUR_PUBKEY,
      webhooks: [],
      web_push_subscriptions: [push],
    },
    duplicate: {
      filter: {kinds: [MESSAGE_EVENT_KIND], authors: [PEER_TWO]},
      subscriber: OUR_PUBKEY,
      webhooks: [],
      web_push_subscriptions: [push],
    },
  }

  it("deletes every managed DM subscription when DMs are disabled", () => {
    expect(planDmNotificationSync(subscriptions, push, [PEER_ONE], false)).toEqual({
      deleteIds: ["first", "duplicate"],
      register: false,
    })
  })

  it("updates one subscription and removes duplicates when authors change", () => {
    expect(
      planDmNotificationSync(subscriptions, push, [PEER_ONE, PEER_TWO], true)
    ).toEqual({
      deleteIds: ["duplicate"],
      register: false,
      update: ["first", subscriptions.first],
    })
  })

  it("registers when enabled sessions have no subscription", () => {
    expect(planDmNotificationSync({}, push, [PEER_ONE], true)).toEqual({
      deleteIds: [],
      register: true,
    })
  })

  it("compares authors as sets when stored values contain duplicates", () => {
    const duplicatedAuthors = {
      first: {
        ...subscriptions.first,
        filter: {kinds: [MESSAGE_EVENT_KIND], authors: [PEER_ONE, PEER_ONE]},
      },
    }

    expect(
      planDmNotificationSync(duplicatedAuthors, push, [PEER_ONE, PEER_TWO], true)
    ).toEqual({
      deleteIds: [],
      register: false,
      update: ["first", duplicatedAuthors.first],
    })
  })
})

describe("clearNotifications", () => {
  it("tolerates Safari registrations without getNotifications", async () => {
    const getRegistrations = vi.fn(async () => [{}])
    vi.stubGlobal("navigator", {serviceWorker: {getRegistrations}})

    await expect(clearNotifications()).resolves.toBeUndefined()
    expect(getRegistrations).toHaveBeenCalledOnce()

    vi.unstubAllGlobals()
  })

  it("closes notifications when the browser exposes the API", async () => {
    const close = vi.fn()
    const getNotifications = vi.fn(async () => [{close}])
    vi.stubGlobal("navigator", {
      serviceWorker: {getRegistrations: vi.fn(async () => [{getNotifications}])},
    })

    await clearNotifications()

    expect(getNotifications).toHaveBeenCalledOnce()
    expect(close).toHaveBeenCalledOnce()
    vi.unstubAllGlobals()
  })

  it("keeps unrelated post alerts on focus and clears only the viewed target for this account", async () => {
    const push = (kind: number, id: string, tags: string[][]) => ({
      close: vi.fn(),
      data: {event: {kind, id, tags}},
    })
    const tags = [
      ["e", "root", "", "root"],
      ["e", "post", "", "reply"],
      ["p", OUR_PUBKEY],
    ]
    const reply = push(1, "reply", tags)
    const reaction = push(7, "reaction", tags)
    const other = push(7, "other", [
      ["e", "root"],
      ["p", OUR_PUBKEY],
    ])
    const otherUser = push(7, "other-user", [
      ["e", "post"],
      ["p", PEER_ONE],
    ])
    const message = push(MESSAGE_EVENT_KIND, "message", [])
    const alerts = [reply, reaction, other, otherUser, message]
    vi.stubGlobal("navigator", {
      serviceWorker: {
        getRegistrations: async () => [{getNotifications: async () => alerts}],
      },
    })
    try {
      await clearNotifications()
      expect(alerts.filter((alert) => alert.close.mock.calls.length)).toEqual([message])
      await clearNotifications({publicKey: OUR_PUBKEY, postId: "reply"})
      expect(reply.close).toHaveBeenCalledOnce()
      expect(reaction.close).not.toHaveBeenCalled()
      await clearNotifications({publicKey: OUR_PUBKEY, postId: "post"})
      expect(reaction.close).toHaveBeenCalledOnce()
      expect(other.close).not.toHaveBeenCalled()
      await clearNotifications({publicKey: OUR_PUBKEY})
      expect(other.close).toHaveBeenCalledOnce()
      expect(otherUser.close).not.toHaveBeenCalled()
      expect(message.close).toHaveBeenCalledOnce()
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe("reaction notification grouping", () => {
  it("keeps popular posts together when every target has multiple reacting people", async () => {
    const {groupNotifications} = await import("./groupNotifications")
    const {AppEvent} = await import("@/lib/nostr")
    const {SortedMap} = await import("./SortedMap/SortedMap")
    const items = [1, 2, 3].map((post) => {
      const target = post.toString().padStart(64, "0")
      const events = Array.from({length: 6}, (_, index) => {
        const user = (index + 10).toString(16).repeat(64)
        const event = new AppEvent(undefined, {
          id: (post * 10 + index).toString(16).padStart(64, "0"),
          kind: 7,
          pubkey: user,
          content: "+",
          created_at: post,
          tags: [["e", target]],
        })
        return {user, event, time: post, content: "+"}
      })
      const notification = {
        id: events[0].event.id,
        originalEventId: target,
        kind: 7,
        time: post,
        content: "+",
        events,
        users: new SortedMap<string, {time: number}>([], "time"),
      }
      return [target, notification] as const
    })
    const rows = groupNotifications(new Map(items))
    expect(rows.map((row) => row.key)).toEqual(items.map(([key]) => key).reverse())
    expect(
      rows.every((row) => "notification" in row && row.notification.events.length === 6)
    ).toBe(true)
  })
})

describe("bulk post notifications in the background worker", () => {
  it("counts distinct valid recipients and preserves direct follows, immediate replies, and non-post kinds", async () => {
    const {shouldHideBulkPush, PUSH_VIEWER_KEY, pushFollowsKey} =
      await import("./bulkNotificationCache")
    const {getMainThreadDb} = await import("@/lib/nostr/db")
    const {finalizeEvent, generateSecretKey, getPublicKey} = await import("nostr-tools")
    const localforage = (await import("localforage")).default
    const viewerKey = generateSecretKey(),
      viewer = getPublicKey(viewerKey)
    const strangerKey = generateSecretKey(),
      stranger = getPublicKey(strangerKey)
    const sign = (key: Uint8Array, kind: number, tags: string[][]) =>
      finalizeEvent({kind, tags, content: "test", created_at: 123456}, key)
    const parent = sign(viewerKey, 1, [])
    const other = sign(strangerKey, 1, [])
    const contact = Array.from({length: 10}, (_, i) => [
      "p",
      (i + 1).toString(16).padStart(64, "0"),
    ])
    const ten = [
      ["p", viewer],
      ...contact.slice(1),
      ["p", viewer],
      ["p", stranger.toUpperCase()],
      ["p", "broken"],
      ["P", stranger],
    ]
    const many = [...ten, contact[0]]
    const follows: string[] = []
    const read = vi.spyOn(localforage, "getItem").mockImplementation(async (key) => {
      if (key === PUSH_VIEWER_KEY) return viewer
      return key === pushFollowsKey(viewer) ? follows : null
    })
    const hide = (tags: string[][], kind = 1) =>
      shouldHideBulkPush(sign(strangerKey, kind, tags))
    try {
      expect(await hide(ten)).toBe(false)
      expect(read).not.toHaveBeenCalled()
      expect(await hide(many)).toBe(true)
      for (const kind of [7, 6, 9735, 23195]) expect(await hide(many, kind)).toBe(false)
      for (const kind of [20, 9802]) expect(await hide(many, kind)).toBe(true)
      follows.push(stranger)
      expect(await hide(many)).toBe(false)
      follows.length = 0
      const root = ["e", parent.id, "", "root", viewer]
      const reply = ["e", other.id, "", "reply", stranger]
      expect(await hide([...many, root])).toBe(false)
      expect(await hide([...many, root, reply])).toBe(true)
      expect(await hide([...many, ["e", parent.id, "", "mention", viewer]])).toBe(true)
      expect(await hide([...many, root, ["e", other.id]])).toBe(true)
      const db = getMainThreadDb()
      for (const event of [parent, other])
        await db.events.put({
          id: event.id,
          pubkey: event.pubkey,
          kind: event.kind,
          createdAt: event.created_at,
          event: JSON.stringify(event),
        })
      expect(await hide([...many, ["e", parent.id, "", "reply"]])).toBe(false)
      expect(await hide([...many, ["e", other.id, "", "reply", viewer]])).toBe(true)
      await db.events.bulkDelete([parent.id, other.id])
    } finally {
      read.mockRestore()
    }
  })
})
