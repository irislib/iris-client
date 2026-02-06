export type ServiceWorkerAutoReloadOptions = {
  // Allow dependency injection for unit tests (vitest runs in node env).
  serviceWorker?: {
    controller: unknown | null
    ready: Promise<{
      update: () => Promise<unknown>
      waiting?: {postMessage: (message: unknown) => void} | null
      installing?: {
        state: string
        addEventListener: (type: "statechange", listener: () => void) => void
      } | null
      addEventListener: (type: "updatefound", listener: () => void) => void
    }>
    addEventListener: (type: "controllerchange", listener: () => void) => void
    removeEventListener: (type: "controllerchange", listener: () => void) => void
  }
  sessionStorage?: Pick<Storage, "getItem" | "setItem">
  location?: {reload: () => void}
  setInterval?: typeof globalThis.setInterval
  clearInterval?: typeof globalThis.clearInterval
  now?: () => number
  updateIntervalMs?: number
  reloadDebounceMs?: number
}

const DEFAULT_UPDATE_INTERVAL_MS = 60_000
const DEFAULT_RELOAD_DEBOUNCE_MS = 10_000

const RELOAD_AT_KEY = "sw-reload-at"

function maybeSkipWaiting(
  serviceWorker: NonNullable<ServiceWorkerAutoReloadOptions["serviceWorker"]>,
  registration: Awaited<NonNullable<ServiceWorkerAutoReloadOptions["serviceWorker"]>["ready"]>
) {
  // Only auto-activate on updates (not first install).
  if (!serviceWorker.controller) return

  if (!registration.waiting) return

  registration.waiting.postMessage({type: "SKIP_WAITING"})
}

/**
 * Initialize service-worker auto update + auto reload when a new SW takes control.
 *
 * This is modeled after `iris-chat/src/swInit.ts`, but keeps the logic testable
 * by allowing dependency injection.
 */
export function initServiceWorkerAutoReload(opts: ServiceWorkerAutoReloadOptions = {}) {
  const serviceWorker =
    opts.serviceWorker ?? (typeof navigator !== "undefined" ? navigator.serviceWorker : undefined)
  if (!serviceWorker) return () => {}

  const sessionStorageRef =
    opts.sessionStorage ?? (typeof sessionStorage !== "undefined" ? sessionStorage : undefined)
  if (!sessionStorageRef) return () => {}

  const locationRef = opts.location ?? (typeof location !== "undefined" ? location : undefined)
  if (!locationRef) return () => {}

  const now = opts.now ?? (() => Date.now())
  const setIntervalFn = opts.setInterval ?? setInterval
  const clearIntervalFn = opts.clearInterval ?? clearInterval

  const updateIntervalMs = opts.updateIntervalMs ?? DEFAULT_UPDATE_INTERVAL_MS
  const reloadDebounceMs = opts.reloadDebounceMs ?? DEFAULT_RELOAD_DEBOUNCE_MS

  const hadControllerInitially = Boolean(serviceWorker.controller)
  let sawFirstControllerChange = false

  const onControllerChange = () => {
    // First time a SW takes control (fresh install): don't reload.
    if (!hadControllerInitially && !sawFirstControllerChange) {
      sawFirstControllerChange = true
      return
    }

    const t = now()
    const lastReloadAt = Number(sessionStorageRef.getItem(RELOAD_AT_KEY) || 0)
    if (lastReloadAt > 0 && t - lastReloadAt < reloadDebounceMs) return

    sessionStorageRef.setItem(RELOAD_AT_KEY, String(t))
    locationRef.reload()
  }

  serviceWorker.addEventListener("controllerchange", onControllerChange)

  let intervalId: ReturnType<typeof setInterval> | null = null

  serviceWorker.ready
    .then((registration) => {
      maybeSkipWaiting(serviceWorker, registration)

      registration.addEventListener("updatefound", () => {
        const installing = registration.installing
        if (!installing) return

        installing.addEventListener("statechange", () => {
          if (installing.state !== "installed") return
          maybeSkipWaiting(serviceWorker, registration)
        })
      })

      intervalId = setIntervalFn(() => {
        registration.update().catch(() => {})
      }, updateIntervalMs)
    })
    .catch(() => {})

  return () => {
    if (intervalId) clearIntervalFn(intervalId)
    serviceWorker.removeEventListener("controllerchange", onControllerChange)
  }
}
