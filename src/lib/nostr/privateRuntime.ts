import {
  createAnonymousRelayDiscovery,
  createNostrRuntime,
  createPrivateRelayPublisher,
  isPrivateRelayEvent,
  MemoryEventStore,
  publicationLaneStore,
  type NostrRuntimeOptions,
  type RuntimeEventStore,
} from "nostr-pubsub"
import type {VerifiedEvent} from "nostr-tools"
import {assertPrivatePublicationPolicy} from "@/shared/services/privatePublishPolicy"
import {privateDiscoverySubscribe} from "./privateDiscoveryRouting"

/** Relay reception, private sending and public key lookups use separate sockets. */
export function createPrivateNostrRuntime(
  options: NostrRuntimeOptions,
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
  const privateSender = createPrivateRelayPublisher({
    relays: options.relays,
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
  receiver.subscribe = privateDiscoverySubscribe(
    receiver.subscribe.bind(receiver),
    discovery.subscribe.bind(discovery)
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
      ? privateSender.publish(event, publishOptions)
      : publish(event, publishOptions)
  }
  const setRelays = receiver.setRelays.bind(receiver)
  receiver.setRelays = (urls) => {
    setRelays(urls)
    privateSender.setRelays(urls)
    discovery.setRelays(urls)
  }
  const addSource = receiver.addSource.bind(receiver)
  const removeSource = receiver.removeSource.bind(receiver)
  receiver.addSource = (source) => {
    addSource(source)
    if (source.publish) privateSender.addSource({...source, publish: source.publish})
  }
  receiver.removeSource = (id) => {
    removeSource(id)
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
    for (const stat of [...privateSender.getRelayStats(), ...discovery.getRelayStats()])
      stats.set(stat.url, {
        ...stat,
        connected: stat.connected || !!stats.get(stat.url)?.connected,
      })
    return [...stats.values()]
  }
  const close = receiver.close.bind(receiver)
  receiver.close = async () => {
    closed = true
    const closing = Promise.all([close(), privateSender.close(), discovery.close()])
    await migration.catch(() => {})
    await closing
    await Promise.all([cache.close?.(), pendingStore.close?.()])
  }
  for (const source of options.sources ?? []) receiver.addSource(source)
  return receiver
}
