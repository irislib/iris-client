import {describe, expect, it, vi, beforeEach, afterEach} from "vitest"
import {initServiceWorkerAutoReload} from "./swInit"

type Listener = () => void

class FakeEventTarget {
  private listeners = new Map<string, Set<Listener>>()

  addEventListener(type: string, listener: Listener) {
    const set = this.listeners.get(type) ?? new Set<Listener>()
    set.add(listener)
    this.listeners.set(type, set)
  }

  removeEventListener(type: string, listener: Listener) {
    const set = this.listeners.get(type)
    if (!set) return
    set.delete(listener)
    if (set.size === 0) this.listeners.delete(type)
  }

  dispatch(type: string) {
    const set = this.listeners.get(type)
    if (!set) return
    ;[...set].forEach((listener) => listener())
  }
}

class FakeServiceWorker extends FakeEventTarget {
  state = "installing"
  postMessage = vi.fn()
}

class FakeRegistration extends FakeEventTarget {
  update = vi.fn(async () => {})
  waiting: FakeServiceWorker | null = null
  installing: FakeServiceWorker | null = null
}

class FakeServiceWorkerContainer extends FakeEventTarget {
  controller: unknown | null = null
  ready: Promise<FakeRegistration>

  constructor(ready: Promise<FakeRegistration>) {
    super()
    this.ready = ready
  }
}

describe("initServiceWorkerAutoReload", () => {
  beforeEach(() => {
    sessionStorage.clear()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("does nothing if serviceWorker is missing", () => {
    const cleanup = initServiceWorkerAutoReload({
      serviceWorker: undefined,
    })
    expect(typeof cleanup).toBe("function")
  })

  it("does not reload on the first controllerchange when there was no controller initially", async () => {
    const registration = new FakeRegistration()
    const container = new FakeServiceWorkerContainer(Promise.resolve(registration))
    container.controller = null

    const location = {reload: vi.fn()}
    const now = vi.fn(() => 1_000)

    const cleanup = initServiceWorkerAutoReload({
      serviceWorker: container,
      sessionStorage,
      location,
      now,
      updateIntervalMs: 60_000,
      reloadDebounceMs: 10_000,
    })

    container.dispatch("controllerchange")
    expect(location.reload).not.toHaveBeenCalled()

    cleanup()
  })

  it("reloads on controllerchange when a controller already existed", async () => {
    const registration = new FakeRegistration()
    const container = new FakeServiceWorkerContainer(Promise.resolve(registration))
    container.controller = {}

    const location = {reload: vi.fn()}
    const now = vi.fn(() => 2_000)

    const cleanup = initServiceWorkerAutoReload({
      serviceWorker: container,
      sessionStorage,
      location,
      now,
      updateIntervalMs: 60_000,
      reloadDebounceMs: 10_000,
    })

    container.dispatch("controllerchange")
    expect(location.reload).toHaveBeenCalledTimes(1)

    cleanup()
  })

  it("debounces repeated reloads", async () => {
    const registration = new FakeRegistration()
    const container = new FakeServiceWorkerContainer(Promise.resolve(registration))
    container.controller = {}

    let t = 10_000
    const now = vi.fn(() => t)
    const location = {reload: vi.fn()}

    const cleanup = initServiceWorkerAutoReload({
      serviceWorker: container,
      sessionStorage,
      location,
      now,
      updateIntervalMs: 60_000,
      reloadDebounceMs: 10_000,
    })

    container.dispatch("controllerchange")
    expect(location.reload).toHaveBeenCalledTimes(1)

    t += 1_000
    container.dispatch("controllerchange")
    expect(location.reload).toHaveBeenCalledTimes(1)

    cleanup()
  })

  it("posts SKIP_WAITING when an update is already waiting", async () => {
    const waiting = new FakeServiceWorker()
    const registration = new FakeRegistration()
    registration.waiting = waiting

    const container = new FakeServiceWorkerContainer(Promise.resolve(registration))
    container.controller = {} // controlled => update scenario

    const cleanup = initServiceWorkerAutoReload({
      serviceWorker: container,
      sessionStorage,
      location: {reload: vi.fn()},
      now: () => 123,
    })

    // allow ready handler to run
    await Promise.resolve()

    expect(waiting.postMessage).toHaveBeenCalledWith({type: "SKIP_WAITING"})
    cleanup()
  })

  it("checks for updates periodically", async () => {
    const registration = new FakeRegistration()
    const container = new FakeServiceWorkerContainer(Promise.resolve(registration))
    container.controller = {}

    const cleanup = initServiceWorkerAutoReload({
      serviceWorker: container,
      sessionStorage,
      location: {reload: vi.fn()},
      now: () => 0,
      updateIntervalMs: 60_000,
    })

    await Promise.resolve()

    expect(registration.update).toHaveBeenCalledTimes(0)

    vi.advanceTimersByTime(60_000)
    await Promise.resolve()

    expect(registration.update).toHaveBeenCalledTimes(1)
    cleanup()
  })

  it("posts SKIP_WAITING when updatefound finishes installing (installed -> waiting)", async () => {
    const waiting = new FakeServiceWorker()
    const registration = new FakeRegistration()
    const installing = new FakeServiceWorker()
    registration.installing = installing

    const container = new FakeServiceWorkerContainer(Promise.resolve(registration))
    container.controller = {}

    const cleanup = initServiceWorkerAutoReload({
      serviceWorker: container,
      sessionStorage,
      location: {reload: vi.fn()},
      now: () => 0,
    })

    await Promise.resolve()

    // SW update discovered
    registration.dispatch("updatefound")

    // install completes, and the SW moves to `waiting`
    registration.waiting = waiting
    installing.state = "installed"
    installing.dispatch("statechange")

    expect(waiting.postMessage).toHaveBeenCalledWith({type: "SKIP_WAITING"})
    cleanup()
  })
})

