import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

const ACCOUNT_A = "a".repeat(64)
const ACCOUNT_B = "b".repeat(64)
const DIRECT_FOLLOW = "c".repeat(64)
const INITIAL_SYNC_TIMEOUT_MS = 8_000

const createDeferred = <T>() => {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return {promise, resolve}
}

const userStoreMock = vi.hoisted(() => {
  type UserState = {publicKey: string}
  type Listener = (state: UserState, previousState: UserState) => void

  let state: UserState = {publicKey: ""}
  const listeners = new Set<Listener>()

  const useUserStore = Object.assign(
    (selector: (currentState: UserState) => unknown) => selector(state),
    {
      getState: () => state,
      setState: (update: Partial<UserState>) => {
        const previousState = state
        state = {...state, ...update}
        listeners.forEach((listener) => listener(state, previousState))
      },
      subscribe: (listener: Listener) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
    }
  )

  return {
    useUserStore,
    reset(publicKey: string) {
      state = {publicKey}
      listeners.clear()
    },
  }
})

const graphStoreMock = vi.hoisted(() => {
  interface GraphState {
    isReady: boolean
    isRecrawling: boolean
    version: number
    muteListVersion: number
    setReady: (isReady: boolean) => void
    setIsRecrawling: (isRecrawling: boolean) => void
    incrementVersion: () => void
    incrementMuteListVersion: () => void
  }

  let state: GraphState

  const reset = () => {
    state = {
      isReady: false,
      isRecrawling: false,
      version: 0,
      muteListVersion: 0,
      setReady: (isReady) => {
        state = {...state, isReady}
      },
      setIsRecrawling: (isRecrawling) => {
        state = {...state, isRecrawling}
      },
      incrementVersion: () => {
        state = {...state, version: state.version + 1}
      },
      incrementMuteListVersion: () => {
        state = {...state, muteListVersion: state.muteListVersion + 1}
      },
    }
  }
  reset()

  const useSocialGraphStore = Object.assign(
    (selector: (currentState: GraphState) => unknown) => selector(state),
    {getState: () => state}
  )

  return {useSocialGraphStore, reset}
})

const socialGraphMock = vi.hoisted(() => {
  interface DeferredVoid {
    promise: Promise<void>
    resolve: (value?: void | PromiseLike<void>) => void
  }

  let accountARecalculation: DeferredVoid | undefined
  let currentRoot: string | undefined
  const follows = new Map<string, Set<string>>()

  class FakeSocialGraph {
    private root: string

    constructor(root: string) {
      this.root = root
      currentRoot = root
    }

    static async fromBinary(root: string) {
      return new FakeSocialGraph(root)
    }

    getRoot() {
      return this.root
    }

    setRoot(root: string) {
      this.root = root
      currentRoot = root
      if (root === ACCOUNT_A && accountARecalculation) {
        return accountARecalculation.promise
      }
      return Promise.resolve()
    }

    recalculateFollowDistances() {
      if (this.root === ACCOUNT_A && accountARecalculation) {
        return accountARecalculation.promise
      }
      return Promise.resolve()
    }

    getFollowedByUser(publicKey: string) {
      return new Set(follows.get(publicKey) || [])
    }

    getMutedByUser() {
      return new Set<string>()
    }

    getUserMutedBy() {
      return new Set<string>()
    }

    getFollowDistance() {
      return Number.POSITIVE_INFINITY
    }

    isFollowing() {
      return false
    }

    stats() {
      return {}
    }

    size() {
      return 0
    }

    handleEvent(event: {kind?: number; pubkey: string; tags?: string[][]}) {
      if (event.kind === 3) {
        follows.set(
          event.pubkey,
          new Set(
            (event.tags || [])
              .filter((tag) => tag[0] === "p" && tag[1])
              .map((tag) => tag[1])
          )
        )
      }
      return false
    }

    async toBinary() {
      return new Uint8Array()
    }
  }

  return {
    FakeSocialGraph,
    deferAccountARecalculation(deferred: DeferredVoid) {
      accountARecalculation = deferred
    },
    getRoot: () => currentRoot,
    reset() {
      accountARecalculation = undefined
      currentRoot = undefined
      follows.clear()
    },
  }
})

const ndkMock = vi.hoisted(() => {
  type Handler = (...args: any[]) => void

  class FakeSubscription {
    readonly handlers = new Map<string, Set<Handler>>()
    stopped = false

    constructor(
      readonly filters: unknown,
      readonly options: unknown
    ) {}

    on(type: string, handler: Handler) {
      const handlers = this.handlers.get(type) || new Set<Handler>()
      handlers.add(handler)
      this.handlers.set(type, handlers)
      return this
    }

    emit(type: string, ...args: any[]) {
      this.handlers.get(type)?.forEach((handler) => handler(...args))
    }

    stop() {
      this.stopped = true
    }
  }

  const subscriptions: FakeSubscription[] = []
  const subscribe = vi.fn((filters: unknown, options?: unknown) => {
    const subscription = new FakeSubscription(filters, options)
    subscriptions.push(subscription)
    return subscription
  })

  return {
    subscriptions,
    subscribe,
    initNDK: vi.fn(() => Promise.resolve()),
    ndk: () => ({subscribe}),
    reset() {
      subscriptions.splice(0)
      subscribe.mockClear()
      this.initNDK.mockClear()
    },
  }
})

const storageMock = vi.hoisted(() => ({
  getItem: vi.fn(() => Promise.resolve(new Uint8Array([1]))),
  removeItem: vi.fn(() => Promise.resolve()),
  setItem: vi.fn(() => Promise.resolve()),
}))

vi.mock("@/stores/user", () => ({useUserStore: userStoreMock.useUserStore}))
vi.mock("@/stores/socialGraph", () => ({
  useSocialGraphStore: graphStoreMock.useSocialGraphStore,
}))
vi.mock("nostr-social-graph", () => ({SocialGraph: socialGraphMock.FakeSocialGraph}))
vi.mock("@/utils/ndk", () => ({ndk: ndkMock.ndk, initNDK: ndkMock.initNDK}))
vi.mock("@/lib/ndk", () => ({
  NDKSubscription: class NDKSubscription {},
  NDKSubscriptionCacheUsage: {ONLY_RELAY: "ONLY_RELAY"},
}))
vi.mock("localforage", () => ({default: storageMock}))
vi.mock("@/utils/createDebugLogger", () => ({
  createDebugLogger: () => ({log: vi.fn(), error: vi.fn()}),
}))

const flushMicrotasks = async () => {
  for (let index = 0; index < 50; index += 1) {
    await Promise.resolve()
  }
}

const rootSubscriptionFor = (publicKey: string) =>
  ndkMock.subscriptions.find((subscription) => {
    if (!Array.isArray(subscription.filters)) return false
    return subscription.filters.some(
      (filter) =>
        typeof filter === "object" &&
        filter !== null &&
        "authors" in filter &&
        Array.isArray(filter.authors) &&
        filter.authors.includes(publicKey)
    )
  })

const rootSubscriptionsFor = (publicKey: string) =>
  ndkMock.subscriptions.filter((subscription) => {
    if (!Array.isArray(subscription.filters)) return false
    return subscription.filters.some(
      (filter) =>
        typeof filter === "object" &&
        filter !== null &&
        "authors" in filter &&
        Array.isArray(filter.authors) &&
        filter.authors.includes(publicKey)
    )
  })

const opinionSubscriptionsFor = (publicKey: string) =>
  ndkMock.subscriptions.filter((subscription) => {
    if (Array.isArray(subscription.filters)) return false
    const filter = subscription.filters as {authors?: string[]}
    return filter.authors?.includes(publicKey)
  })

describe("social graph auth-switch readiness", () => {
  beforeEach(() => {
    vi.resetModules()
    vi.useFakeTimers()
    userStoreMock.reset(ACCOUNT_A)
    graphStoreMock.reset()
    socialGraphMock.reset()
    ndkMock.reset()
    storageMock.getItem.mockClear()
  })

  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  it("does not let an older setup install or stop a newer account subscription", async () => {
    const accountARecalculation = createDeferred<void>()
    socialGraphMock.deferAccountARecalculation(accountARecalculation)

    const {setupSocialGraphSubscriptions, socialGraphLoaded} =
      await import("./socialGraph")
    await socialGraphLoaded

    void setupSocialGraphSubscriptions()
    await flushMicrotasks()

    userStoreMock.useUserStore.setState({publicKey: ACCOUNT_B})
    await flushMicrotasks()

    const accountBSubscription = rootSubscriptionFor(ACCOUNT_B)
    expect(accountBSubscription).toBeDefined()
    expect(accountBSubscription?.stopped).toBe(false)
    expect(graphStoreMock.useSocialGraphStore.getState().isReady).toBe(false)

    accountARecalculation.resolve()
    await flushMicrotasks()

    expect(rootSubscriptionFor(ACCOUNT_A)).toBeUndefined()
    expect(rootSubscriptionFor(ACCOUNT_B)).toBe(accountBSubscription)
    expect(accountBSubscription?.stopped).toBe(false)
    expect(socialGraphMock.getRoot()).toBe(ACCOUNT_B)
    expect(graphStoreMock.useSocialGraphStore.getState().isReady).toBe(false)
  })

  it("only marks the current account ready when its initial sync completes", async () => {
    const accountARecalculation = createDeferred<void>()
    socialGraphMock.deferAccountARecalculation(accountARecalculation)

    const {setupSocialGraphSubscriptions, socialGraphLoaded} =
      await import("./socialGraph")
    await socialGraphLoaded

    void setupSocialGraphSubscriptions()
    await flushMicrotasks()
    userStoreMock.useUserStore.setState({publicKey: ACCOUNT_B})
    await flushMicrotasks()

    const accountBSubscription = rootSubscriptionFor(ACCOUNT_B)
    expect(accountBSubscription).toBeDefined()

    accountARecalculation.resolve()
    await flushMicrotasks()
    expect(graphStoreMock.useSocialGraphStore.getState().isReady).toBe(false)

    accountBSubscription?.emit("eose")
    await vi.advanceTimersByTimeAsync(300)
    await flushMicrotasks()

    expect(socialGraphMock.getRoot()).toBe(ACCOUNT_B)
    expect(graphStoreMock.useSocialGraphStore.getState().isReady).toBe(true)
    expect(accountBSubscription?.stopped).toBe(true)
    const accountBSubscriptions = rootSubscriptionsFor(ACCOUNT_B)
    expect(accountBSubscriptions).toHaveLength(2)
    expect(accountBSubscriptions[1].stopped).toBe(false)
  })

  it("cuts over after a bounded zero-EOSE timeout while keeping relay data", async () => {
    userStoreMock.reset(ACCOUNT_B)
    const {setupSocialGraphSubscriptions, socialGraphLoaded} =
      await import("./socialGraph")
    await socialGraphLoaded

    const setup = setupSocialGraphSubscriptions()
    await flushMicrotasks()
    const hydrationSubscription = rootSubscriptionFor(ACCOUNT_B)
    expect(hydrationSubscription).toBeDefined()
    expect(graphStoreMock.useSocialGraphStore.getState().isReady).toBe(false)

    hydrationSubscription?.emit("event", {
      id: "responsive-relay-contacts",
      kind: 3,
      pubkey: ACCOUNT_B,
      created_at: 1,
      tags: [["p", DIRECT_FOLLOW]],
      content: "",
      sig: "signature",
    })

    await vi.advanceTimersByTimeAsync(INITIAL_SYNC_TIMEOUT_MS - 1)
    await flushMicrotasks()
    expect(graphStoreMock.useSocialGraphStore.getState().isReady).toBe(false)

    await vi.advanceTimersByTimeAsync(1)
    await flushMicrotasks()
    await setup

    const rootSubscriptions = rootSubscriptionsFor(ACCOUNT_B)
    expect(hydrationSubscription?.stopped).toBe(true)
    expect(rootSubscriptions).toHaveLength(2)
    expect(rootSubscriptions[1].stopped).toBe(false)
    expect(opinionSubscriptionsFor(DIRECT_FOLLOW)).toHaveLength(1)
    expect(graphStoreMock.useSocialGraphStore.getState().isReady).toBe(true)
  })

  it("waits for direct-follow opinions before cutting over to background sync", async () => {
    userStoreMock.reset(ACCOUNT_B)
    const {setupSocialGraphSubscriptions, socialGraphLoaded} =
      await import("./socialGraph")
    await socialGraphLoaded

    const setup = setupSocialGraphSubscriptions()
    await flushMicrotasks()
    const rootHydration = rootSubscriptionFor(ACCOUNT_B)
    expect(rootHydration).toBeDefined()

    rootHydration?.emit("event", {
      id: "root-contacts",
      kind: 3,
      pubkey: ACCOUNT_B,
      created_at: 1,
      tags: [["p", DIRECT_FOLLOW]],
      content: "",
      sig: "signature",
    })
    rootHydration?.emit("eose")
    await vi.advanceTimersByTimeAsync(300)
    await flushMicrotasks()

    const opinionHydration = opinionSubscriptionsFor(DIRECT_FOLLOW)[0]
    expect(opinionHydration).toBeDefined()
    expect(graphStoreMock.useSocialGraphStore.getState().isReady).toBe(false)
    expect(rootHydration?.stopped).toBe(false)

    opinionHydration.emit("eose")
    await vi.advanceTimersByTimeAsync(300)
    await flushMicrotasks()
    await setup

    const opinionSubscriptions = opinionSubscriptionsFor(DIRECT_FOLLOW)
    expect(rootHydration?.stopped).toBe(true)
    expect(opinionHydration.stopped).toBe(true)
    expect(opinionSubscriptions).toHaveLength(2)
    expect(opinionSubscriptions[1].stopped).toBe(false)
    expect(graphStoreMock.useSocialGraphStore.getState().isReady).toBe(true)
  })
})
