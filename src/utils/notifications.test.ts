import {describe, expect, it, vi} from "vitest"
import {MESSAGE_EVENT_KIND} from "nostr-double-ratchet"
import {
  clearNotifications,
  createLatestNotificationSyncQueue,
  extractSessionPubkeysFromUserRecords,
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

function createUserRecordsWithSelfSessions() {
  return new Map([
    [
      PEER_ONE,
      {
        devices: new Map([
          [
            "device-1",
            {
              activeSession: {
                state: {
                  theirCurrentNostrPublicKey: OUR_PUBKEY,
                  theirNextNostrPublicKey: PEER_ONE,
                },
              },
              inactiveSessions: [
                {
                  state: {
                    theirCurrentNostrPublicKey: OUR_PUBKEY,
                    theirNextNostrPublicKey: PEER_TWO,
                  },
                },
              ],
            },
          ],
        ]),
      },
    ],
  ]) as any
}

describe("extractSessionPubkeysFromUserRecords", () => {
  it("excludes our own pubkey from extracted session authors", () => {
    const result = extractSessionPubkeysFromUserRecords(
      createUserRecordsWithSelfSessions(),
      OUR_PUBKEY
    )

    expect(result).toEqual([PEER_ONE, PEER_TWO])
  })

  it("includes all session pubkeys when our public key is unknown", () => {
    const result = extractSessionPubkeysFromUserRecords(
      createUserRecordsWithSelfSessions()
    )

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
})
