import {
  createAnonymousRelayDiscovery,
  createNostrRuntime,
  createPrivateRelayPublisher,
  isPrivateRelayEvent,
  MemoryEventStore,
  publicationLaneStore,
  type NostrRuntimeOptions,
  type RuntimeEventStore,
  type NostrRuntime,
} from "nostr-pubsub"
import type {VerifiedEvent} from "nostr-tools"
import {assertPrivatePublicationPolicy} from "@/shared/services/privatePublishPolicy"
import {privateDiscoverySubscribe} from "./privateDiscoveryRouting"

/** Relay reception, private sending and public key lookups use separate sockets. */
export function createPrivateNostrRuntime(
  options: NostrRuntimeOptions & {privateRelayUrls?: string[]},
  pendingStore: RuntimeEventStore = new MemoryEventStore(),
  migration: Promise<void> = Promise.resolve()
) {
  const cache: RuntimeEventStore = options.store ?? new MemoryEventStore()
  const receiverStore = publicationLaneStore(cache, "public")
  const canRetry = (event: Parameters<typeof assertPrivatePublicationPolicy>[0]) => {
    try {
      assertPrivatePublicationPolicy(event)
      return true
    } catch {
      return false
    }
  }
  const listPublicPending = receiverStore.listPending
  receiverStore.listPending = async () =>
    (await listPublicPending()).filter((entry) => canRetry(entry.event as VerifiedEvent))
  delete receiverStore.close
  const receiver = createNostrRuntime({...options, sources: [], store: receiverStore})
  let separatePrivateRelays = options.privateRelayUrls !== undefined
  let privateRelays = options.privateRelayUrls ?? options.relays ?? []
  const privateReceiver = createNostrRuntime({
    ...options,
    relays: privateRelays,
    sources: [],
    store: {
      ...receiverStore,
      listPending: async () => [],
      putPending: async () => {
        throw new Error("Private receiver cannot enqueue publications")
      },
      deletePending: async () => {},
    },
  })
  const privateSender = createPrivateRelayPublisher({
    relays: privateRelays,
    websocketImplementation: options.websocketImplementation,
    publishTimeoutMs: options.publishTimeoutMs,
    onError: options.onError,
    store: {
      query: (filters, queryOptions) => cache.query(filters, queryOptions),
      put: (event) => cache.put(event),
      delete: (ids) => cache.delete(ids),
      listPending: async () =>
        (await pendingStore.listPending()).filter((entry) =>
          canRetry(entry.event as VerifiedEvent)
        ),
      putPending: (entry) => {
        assertPrivatePublicationPolicy(entry.event as VerifiedEvent)
        return pendingStore.putPending(entry)
      },
      deletePending: (id) => pendingStore.deletePending(id),
    },
    sources: options.sources?.flatMap((source) =>
      source.publish ? [{...source, publish: source.publish}] : []
    ),
  })
  const discovery = createAnonymousRelayDiscovery({
    relays: options.relays,
    store: cache,
    websocketImplementation: options.websocketImplementation,
    historyTimeoutMs: options.historyTimeoutMs,
    onError: options.onError,
  })
  const privateDiscovery = createAnonymousRelayDiscovery({
    relays: privateRelays,
    store: cache,
    websocketImplementation: options.websocketImplementation,
    historyTimeoutMs: options.historyTimeoutMs,
    onError: options.onError,
  })
  const scopedRelays = (requested?: readonly string[]) => {
    if (requested === undefined) return undefined
    const allowed = new Set(privateRelays.map((url) => url.replace(/\/$/, "")))
    return requested.filter((url) => allowed.has(url.replace(/\/$/, "")))
  }
  const scopedSubscribe =
    (subscribe: NostrRuntime["subscribe"]): NostrRuntime["subscribe"] =>
    (filters, handlers, opts = {}) =>
      subscribe(filters, handlers, {...opts, relays: scopedRelays(opts.relays)})
  const receivePrivate = scopedSubscribe(privateReceiver.subscribe.bind(privateReceiver))
  const discoverPrivate = scopedSubscribe(
    privateDiscovery.subscribe.bind(privateDiscovery)
  )
  const subscribePrivate = privateDiscoverySubscribe(receivePrivate, discoverPrivate)
  receiver.subscribe = privateDiscoverySubscribe(
    receiver.subscribe.bind(receiver),
    discovery.subscribe.bind(discovery),
    {receiver: receivePrivate, discovery: discoverPrivate}
  )
  let closed = false
  void migration
    .then(() => {
      if (!closed) return privateSender.retryPending()
    })
    .catch((error) => options.onError?.(error))
  const publish = receiver.publish.bind(receiver)
  receiver.publish = async (event, publishOptions) => {
    assertPrivatePublicationPolicy(event as VerifiedEvent)
    await migration
    return isPrivateRelayEvent(event)
      ? privateSender.publish(event, {
          ...publishOptions,
          relays: scopedRelays(publishOptions?.relays),
        })
      : publish(event, publishOptions)
  }
  const publishPrivate: NostrRuntime["publish"] = async (event, publishOptions) => {
    assertPrivatePublicationPolicy(event as VerifiedEvent)
    await migration
    return isPrivateRelayEvent(event)
      ? privateSender.publish(event, {
          ...publishOptions,
          relays: scopedRelays(publishOptions?.relays),
        })
      : publish(event, {
          ...publishOptions,
          relays: scopedRelays(publishOptions?.relays) ?? privateRelays,
        })
  }
  const updatePrivateRelays = (urls: readonly string[]) => {
    privateRelays = [...urls]
    privateSender.setRelays(urls)
    privateReceiver.setRelays(urls)
    privateDiscovery.setRelays(urls)
  }
  const setRelays = receiver.setRelays.bind(receiver)
  receiver.setRelays = (urls) => {
    setRelays(urls)
    discovery.setRelays(urls)
    if (!separatePrivateRelays) updatePrivateRelays(urls)
  }
  const addSource = receiver.addSource.bind(receiver)
  const removeSource = receiver.removeSource.bind(receiver)
  receiver.addSource = (source) => {
    addSource(source)
    privateReceiver.addSource(source)
    if (source.publish) privateSender.addSource({...source, publish: source.publish})
  }
  receiver.removeSource = (id) => {
    removeSource(id)
    privateReceiver.removeSource(id)
    privateSender.removeSource(id)
  }
  const retryPending = receiver.retryPending.bind(receiver)
  receiver.retryPending = async () => {
    await migration
    await Promise.all([retryPending(), privateSender.retryPending()])
  }
  const getRelayStats = receiver.getRelayStats.bind(receiver)
  receiver.getRelayStats = () => {
    const stats = new Map(getRelayStats().map((stat) => [stat.url, stat]))
    for (const stat of [
      ...privateSender.getRelayStats(),
      ...privateReceiver.getRelayStats(),
      ...discovery.getRelayStats(),
      ...privateDiscovery.getRelayStats(),
    ])
      stats.set(stat.url, {
        ...stat,
        connected: stat.connected || !!stats.get(stat.url)?.connected,
      })
    return [...stats.values()]
  }
  const close = receiver.close.bind(receiver)
  receiver.close = async () => {
    closed = true
    const closing = Promise.all([
      close(),
      privateSender.close(),
      privateReceiver.close(),
      discovery.close(),
      privateDiscovery.close(),
    ])
    await migration.catch(() => {})
    await closing
    await Promise.all([cache.close?.(), pendingStore.close?.()])
  }
  for (const source of options.sources ?? []) receiver.addSource(source)
  return Object.assign(receiver, {
    subscribePrivate,
    publishPrivate,
    setPrivateRelays: (urls: readonly string[]) => {
      separatePrivateRelays = true
      updatePrivateRelays(urls)
    },
  })
}
