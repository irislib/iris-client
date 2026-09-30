import type {NostrPublishContext} from "nostr-double-ratchet"
import localforage from "localforage"
import type {VerifiedEvent} from "nostr-tools"

interface PendingPublication {
  event: VerifiedEvent
  innerEventId?: string
  context?: NostrPublishContext
}

interface RuntimePublishOptions {
  /** Public identity key whose outgoing envelopes this queue may publish. */
  owner: string
  publish: (
    event: VerifiedEvent,
    innerEventId: string | undefined,
    signal: AbortSignal,
    context?: NostrPublishContext
  ) => Promise<unknown>
  canPublish?: (context: NostrPublishContext) => boolean | Promise<boolean>
  onError: (error: unknown) => void
  storage?: typeof localforage
  onlineTarget?: EventTarget
  retryIntervalMs?: number
}

export const createRuntimePublish = (options: RuntimePublishOptions) => {
  // Share application storage so logout/account deletion also clears unsent work.
  const storage = options.storage ?? localforage
  const prefix = `runtime-publish:${options.owner}:`
  const controller = new AbortController()
  const {signal} = controller
  const enqueuing = new Map<string, Promise<void>>()
  const groupAttempts = new Map<AbortController, string>()
  const groupCancellations = new Map<string, Promise<void>>()
  const inFlight = new Map<string, Promise<void>>()
  const onlineTarget =
    options.onlineTarget ?? (typeof window !== "undefined" ? window : undefined)
  let timer: ReturnType<typeof setInterval> | undefined
  let started = false
  let scanning = false

  const enqueue = async (
    event: VerifiedEvent,
    innerEventId?: string,
    context?: NostrPublishContext
  ): Promise<void> => {
    signal.throwIfAborted()
    if (context && groupCancellations.has(context.groupId))
      throw new DOMException("Group publications cancelled", "AbortError")
    if (!event.id || !event.sig) throw new Error("Cannot queue an unsigned event")
    const key = prefix + event.id
    const pending = enqueuing.get(key)
    if (pending) return pending

    // Keep the signed envelope unchanged even if its caller later mutates it.
    const row: PendingPublication = {
      event: structuredClone(event),
      innerEventId,
      ...(context && {context: {...context}}),
    }
    const writing = (async () => {
      const existing = await storage.getItem<PendingPublication>(key)
      signal.throwIfAborted()
      if (!existing) await storage.setItem(key, row)
      signal.throwIfAborted()
    })().finally(() => enqueuing.delete(key))
    enqueuing.set(key, writing)
    return writing
  }

  const attempt = (key: string): Promise<void> => {
    const existing = inFlight.get(key)
    if (existing) return existing

    const publishing = (async () => {
      await enqueuing.get(key)
      signal.throwIfAborted()
      const row = await storage.getItem<PendingPublication>(key)
      signal.throwIfAborted()
      if (!row) return
      const groupController = row.context ? new AbortController() : undefined
      if (groupController) groupAttempts.set(groupController, row.context!.groupId)
      const attemptSignal = groupController
        ? AbortSignal.any([signal, groupController.signal])
        : signal
      try {
        if (
          row.context &&
          (groupCancellations.has(row.context.groupId) ||
            (options.canPublish && !(await options.canPublish(row.context))))
        ) {
          await storage.removeItem(key)
          return
        }
        attemptSignal.throwIfAborted()
        await options.publish(row.event, row.innerEventId, attemptSignal, row.context)
        attemptSignal.throwIfAborted()
      } finally {
        if (groupController) groupAttempts.delete(groupController)
      }
      // Keep retries until the ACK and host callback succeed for the active account.
      signal.throwIfAborted()
      await storage.removeItem(key)
    })().finally(() => inFlight.delete(key))
    inFlight.set(key, publishing)
    return publishing
  }

  const report = (error: unknown) => {
    if (!signal.aborted) options.onError(error)
  }

  const retry = async () => {
    if (signal.aborted || scanning) return
    scanning = true
    try {
      const keys = await storage.keys()
      if (signal.aborted) return
      for (const key of keys) {
        if (key.startsWith(prefix) && !inFlight.has(key)) {
          // A stalled relay ACK for one envelope must not hold up another.
          void attempt(key).catch(report)
        }
      }
    } catch (error) {
      report(error)
    } finally {
      scanning = false
    }
  }

  return {
    enqueue,
    async publish(
      event: VerifiedEvent,
      innerEventId?: string,
      context?: NostrPublishContext
    ): Promise<void> {
      await enqueue(event, innerEventId, context)
      await attempt(prefix + event.id)
    },
    cancelGroup(groupId: string): Promise<void> {
      const existing = groupCancellations.get(groupId)
      if (existing) return existing
      for (const [attempt, id] of groupAttempts) if (id === groupId) attempt.abort()
      const removing = (async () => {
        // Include envelopes whose durable write was already in progress at removal.
        await Promise.allSettled([...enqueuing.values()])
        signal.throwIfAborted()
        for (const key of await storage.keys()) {
          if (!key.startsWith(prefix)) continue
          const row = await storage.getItem<PendingPublication>(key)
          signal.throwIfAborted()
          if (row?.context?.groupId === groupId) await storage.removeItem(key)
        }
      })().finally(() => groupCancellations.delete(groupId))
      groupCancellations.set(groupId, removing)
      return removing
    },
    async waitForDelivery(matches: (event: VerifiedEvent) => boolean, timeoutMs: number) {
      let timeout: ReturnType<typeof setTimeout> | undefined
      try {
        await Promise.race([
          (async () => {
            signal.throwIfAborted()
            const keys = await storage.keys()
            await Promise.all(
              keys
                .filter((key) => key.startsWith(prefix))
                .map(async (key) => {
                  const row = await storage.getItem<PendingPublication>(key)
                  if (row && matches(row.event)) await attempt(key)
                })
            )
          })(),
          new Promise<never>((_, reject) => {
            timeout = setTimeout(
              () => reject(new Error("Publication confirmation timed out")),
              timeoutMs
            )
          }),
        ])
      } finally {
        clearTimeout(timeout)
      }
    },
    start() {
      if (started || signal.aborted) return
      started = true
      onlineTarget?.addEventListener("online", retry)
      timer = setInterval(retry, Math.max(1000, options.retryIntervalMs ?? 30_000))
      void retry()
    },
    close() {
      controller.abort()
      clearInterval(timer)
      onlineTarget?.removeEventListener("online", retry)
      enqueuing.clear()
      inFlight.clear()
    },
  }
}
