import {beforeEach, describe, expect, it, vi} from "vitest"

const mocks = vi.hoisted(() => {
  type Listener<T> = (state: T, previousState: T) => void
  const observable = <T extends object>(initial: T) => {
    let state = initial
    const listeners = new Set<Listener<T>>()
    return {
      getState: () => state,
      setState: (next: Partial<T>) => {
        const previousState = state
        state = {...state, ...next}
        listeners.forEach((listener) => listener(state, previousState))
      },
      subscribe: (listener: Listener<T>) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
      listenerCount: () => listeners.size,
      reset: () => {
        state = initial
      },
    }
  }

  class FakeSubscription {
    handlers = new Map<string, Set<(value?: never) => void>>()
    stopped = false

    on(name: string, handler: (value?: never) => void) {
      const handlers = this.handlers.get(name) || new Set()
      handlers.add(handler)
      this.handlers.set(name, handlers)
    }

    emit(name: string, value?: unknown) {
      this.handlers.get(name)?.forEach((handler) => handler(value as never))
    }

    stop() {
      if (this.stopped) return
      this.stopped = true
      this.emit("close")
    }
  }

  const socialStore = observable({
    isReady: false,
    version: 0,
    muteListVersion: 0,
  })
  const userStore = observable({publicKey: "viewer"})
  const settingsStore = observable({
    content: {maxFollowDistanceForReplies: 5 as number | undefined},
  })
  const graph = {getRoot: vi.fn(() => "viewer")}
  const subscriptions: FakeSubscription[] = []
  const notifications = new Map<string, any>()
  const hiddenUsers = new Set<string>()
  const notificationsState = {
    latestNotification: 0,
    setLatestNotification: vi.fn((latestNotification: number) => {
      notificationsState.latestNotification = latestNotification
    }),
    updateRefreshRouteSignal: vi.fn(),
  }

  let resolveZapAmount: ((amount: number) => void) | undefined
  const getZapAmount = vi.fn(
    () =>
      new Promise<number>((resolve) => {
        resolveZapAmount = resolve
      })
  )

  return {
    FakeSubscription,
    socialStore,
    userStore,
    settingsStore,
    graph,
    subscriptions,
    notifications,
    hiddenUsers,
    notificationsState,
    getZapAmount,
    resolveZap: (amount: number) => resolveZapAmount?.(amount),
  }
})

vi.mock("lodash/debounce", () => ({
  default: <T extends (...args: any[]) => any>(fn: T) =>
    Object.assign((...args: Parameters<T>) => fn(...args), {cancel: vi.fn()}),
}))
vi.mock("@/utils/socialGraph", () => ({
  socialGraphLoaded: Promise.resolve(true),
  getSocialGraph: () => mocks.graph,
}))
vi.mock("@/stores/socialGraph", () => ({useSocialGraphStore: mocks.socialStore}))
vi.mock("@/stores/user", () => ({useUserStore: mocks.userStore}))
vi.mock("@/stores/settings", () => ({useSettingsStore: mocks.settingsStore}))
vi.mock("@/stores/notifications", () => ({
  useNotificationsStore: {getState: () => mocks.notificationsState},
}))
vi.mock("@/utils/notifications", () => ({notifications: mocks.notifications}))
vi.mock("@/utils/visibility", () => ({
  shouldHideUnsolicitedEvent: vi.fn(
    (_event, user: string) =>
      mocks.hiddenUsers.has(user) ||
      (user === "distant" &&
        (mocks.settingsStore.getState().content.maxFollowDistanceForReplies ?? 1000) < 3)
  ),
}))
vi.mock("@/utils/nostr.ts", () => ({
  getTag: (name: string, tags: string[][]) => tags.find((tag) => tag[0] === name)?.[1],
  getZappingUser: (event: {zapper?: string}) => event.zapper,
  getZapAmount: mocks.getZapAmount,
}))
vi.mock("@/utils/eventCache", () => ({cacheEvent: vi.fn()}))
vi.mock("@/utils/ndk", () => ({
  ndk: () => ({
    subscribe: () => {
      const subscription = new mocks.FakeSubscription()
      mocks.subscriptions.push(subscription)
      return subscription
    },
  }),
}))

import {
  startNotificationsSubscription,
  stopNotificationsSubscription,
} from "./notificationsSubscription"

const flush = async () => {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

const event = (overrides: Record<string, unknown> = {}) => ({
  id: `event-${Math.random()}`,
  pubkey: "sender",
  kind: 1,
  created_at: 10,
  content: "reply",
  tags: [["e", `target-${Math.random()}`]],
  ...overrides,
})

describe("notification subscription visibility lifecycle", () => {
  beforeEach(() => {
    stopNotificationsSubscription()
    mocks.socialStore.reset()
    mocks.userStore.reset()
    mocks.settingsStore.reset()
    mocks.graph.getRoot.mockReturnValue("viewer")
    mocks.subscriptions.length = 0
    mocks.notifications.clear()
    mocks.hiddenUsers.clear()
    mocks.notificationsState.latestNotification = 0
    mocks.notificationsState.setLatestNotification.mockClear()
    mocks.notificationsState.updateRefreshRouteSignal.mockClear()
    mocks.getZapAmount.mockClear()
  })

  it("waits for the matching graph and refetches history after graph rehydration", async () => {
    startNotificationsSubscription("viewer")
    await flush()
    expect(mocks.subscriptions).toHaveLength(0)

    mocks.socialStore.setState({isReady: true})
    await flush()
    expect(mocks.subscriptions).toHaveLength(1)

    const first = mocks.subscriptions[0]
    mocks.socialStore.setState({isReady: false})
    first.emit("event", event())
    expect(mocks.notifications.size).toBe(0)

    mocks.socialStore.setState({isReady: true})
    await flush()
    expect(mocks.subscriptions).toHaveLength(2)
    expect(first.stopped).toBe(true)
  })

  it("disposes a superseded same-auth graph readiness wait", async () => {
    startNotificationsSubscription("viewer")
    await flush()
    expect(mocks.socialStore.listenerCount()).toBe(1)
    expect(mocks.userStore.listenerCount()).toBe(2)

    startNotificationsSubscription("viewer")
    await flush()
    expect(mocks.socialStore.listenerCount()).toBe(1)
    expect(mocks.userStore.listenerCount()).toBe(2)

    stopNotificationsSubscription()
    expect(mocks.socialStore.listenerCount()).toBe(0)
    expect(mocks.userStore.listenerCount()).toBe(0)
  })

  it("applies the shared actor policy to reactions and reposts", async () => {
    mocks.socialStore.setState({isReady: true})
    mocks.hiddenUsers.add("hidden")
    startNotificationsSubscription("viewer")
    await flush()

    const subscription = mocks.subscriptions[0]
    subscription.emit("event", event({kind: 7, pubkey: "hidden"}))
    subscription.emit("event", event({kind: 6, pubkey: "hidden"}))
    subscription.emit("event", event({kind: 7, pubkey: "followed"}))
    await flush()

    expect(mocks.notifications.size).toBe(1)
    expect(Array.from(mocks.notifications.values())[0].users.has("followed")).toBe(true)
  })

  it("cleans existing notifications when reply distance is tightened", async () => {
    mocks.socialStore.setState({isReady: true})
    startNotificationsSubscription("viewer")
    await flush()

    mocks.subscriptions[0].emit("event", event({kind: 7, pubkey: "distant"}))
    expect(mocks.notifications.size).toBe(1)

    mocks.settingsStore.setState({content: {maxFollowDistanceForReplies: 2}})
    expect(mocks.notifications.size).toBe(0)
    expect(mocks.notificationsState.latestNotification).toBe(0)
  })

  it("cleans a zap by attributed sender and resets the latest badge", async () => {
    mocks.socialStore.setState({isReady: true})
    startNotificationsSubscription("viewer")
    await flush()

    mocks.subscriptions[0].emit(
      "event",
      event({kind: 9735, pubkey: "zap-service", zapper: "zapper", created_at: 20})
    )
    mocks.resolveZap(21)
    await flush()
    expect(mocks.notifications.size).toBe(1)
    expect(mocks.notificationsState.latestNotification).toBe(20)

    mocks.hiddenUsers.add("zapper")
    mocks.socialStore.setState({version: 1})

    expect(mocks.notifications.size).toBe(0)
    expect(mocks.notificationsState.latestNotification).toBe(0)
  })

  it.each([
    {label: "reaction", kind: 7},
    {label: "zap", kind: 9735},
  ])(
    "reorders a grouped $label after its newest hidden actor is removed",
    async ({kind}) => {
      mocks.socialStore.setState({isReady: true})
      startNotificationsSubscription("viewer")
      await flush()

      const subscription = mocks.subscriptions[0]
      const emitActor = async (user: string, createdAt: number) => {
        subscription.emit(
          "event",
          event({
            id: `${kind}-${user}`,
            kind,
            pubkey: kind === 9735 ? "zap-service" : user,
            zapper: kind === 9735 ? user : undefined,
            created_at: createdAt,
            tags: [["e", "shared-target"]],
          })
        )
        if (kind === 9735) mocks.resolveZap(createdAt)
        await flush()
      }

      await emitActor("visible", 10)
      await emitActor("newly-hidden", 20)
      expect(mocks.notificationsState.latestNotification).toBe(20)

      mocks.hiddenUsers.add("newly-hidden")
      mocks.socialStore.setState({muteListVersion: 1})

      expect(mocks.notifications.size).toBe(1)
      const grouped = Array.from(mocks.notifications.values())[0]
      expect(grouped.time).toBe(10)
      expect(grouped.users.has("visible")).toBe(true)
      expect(grouped.users.has("newly-hidden")).toBe(false)
      expect(mocks.notificationsState.latestNotification).toBe(10)
      expect(mocks.notificationsState.updateRefreshRouteSignal).toHaveBeenCalled()
    }
  )

  it("cannot add an async zap after logout invalidates its generation", async () => {
    mocks.socialStore.setState({isReady: true})
    startNotificationsSubscription("viewer")
    await flush()

    mocks.subscriptions[0].emit(
      "event",
      event({kind: 9735, pubkey: "zap-service", zapper: "zapper", created_at: 20})
    )
    mocks.userStore.setState({publicKey: ""})
    mocks.resolveZap(21)
    await flush()

    expect(mocks.notifications.size).toBe(0)
    expect(mocks.notificationsState.latestNotification).toBe(0)
    expect(mocks.subscriptions[0].stopped).toBe(true)
  })
})
