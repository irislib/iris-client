import { finalizeEvent, generateSecretKey } from 'nostr-tools/pure';
import {
  MemoryEventStore, NostrRuntime, splitRelayDiscoveryFilters,
  type NostrFilter, type NostrRuntimeOptions, type RuntimeEventStore,
} from 'nostr-pubsub';

// Validate with the shared selector rules before opening an anonymous socket.
function discoveryScope(filters: NostrFilter[]): string {
  const { receiver, discovery } = splitRelayDiscoveryFilters(filters);
  if (receiver.length || discovery.length !== 1 || filters.some(filter =>
    (filter.authors ?? filter['#p'])?.length !== 1)) {
    throw new Error('Discovery requires exactly one public author or device');
  }
  const first = discovery[0]![0]!;
  return first.authors ? 'author:' + first.authors[0] : 'device:' + first['#p']![0];
}

export type AnonymousRelayDiscoveryOptions = Pick<NostrRuntimeOptions,
  'relays' | 'store' | 'websocketImplementation' | 'historyTimeoutMs' | 'reconnectDelayMs' | 'onError'>
  & { maxScopes?: number };
export type AnonymousRelayDiscovery = Pick<NostrRuntime, 'query' | 'subscribe' | 'setRelays' | 'getRelayStats' | 'close'>;

/**
 * Isolate each public lookup key from account reception and every other lookup.
 * Connections authenticate with fresh scope keys and can never publish pending
 * events. The caller retains ownership of a supplied local cache.
 * Network addresses and timing remain observable to message servers.
 */
export function createAnonymousRelayDiscovery(options: AnonymousRelayDiscoveryOptions = {}): AnonymousRelayDiscovery {
  const store = options.store ?? new MemoryEventStore();
  const cache: RuntimeEventStore = {
    query: (filters, queryOptions) => store.query(filters, queryOptions),
    put: event => store.put(event), delete: ids => store.delete(ids),
    listPending: async () => [],
    putPending: async () => { throw new Error('Discovery cannot publish events'); },
    deletePending: async () => { throw new Error('Discovery cannot change publication queues'); },
  };
  const scopes = new Map<string, { runtime: NostrRuntime; users: number }>();
  const closing = new Set<Promise<void>>();
  const maxScopes = options.maxScopes ?? 512;
  if (!Number.isSafeInteger(maxScopes) || maxScopes < 1) throw new RangeError('Invalid discovery scope capacity');
  let relays = options.relays;
  let stopped = false;
  const acquire = (filters: NostrFilter[]) => {
    if (stopped) throw new Error('Discovery is closed');
    const key = discoveryScope(filters);
    let scope = scopes.get(key);
    if (!scope) {
      if (scopes.size >= maxScopes) throw new Error('Discovery connection capacity exhausted');
      const secret = generateSecretKey();
      scope = { users: 0, runtime: new NostrRuntime({
        store: cache, relays, websocketImplementation: options.websocketImplementation,
        historyTimeoutMs: options.historyTimeoutMs, reconnectDelayMs: options.reconnectDelayMs,
        onError: options.onError,
        signAuthEvent: async (_relay, event) => finalizeEvent(event, secret),
      }) };
      scopes.set(key, scope);
    }
    scope.users++;
    let released = false;
    return { runtime: scope.runtime, release() {
      if (released) return;
      released = true;
      if (--scope!.users === 0) {
        scopes.delete(key);
        const finished = scope!.runtime.close().catch(error => options.onError?.(error));
        closing.add(finished);
        void finished.finally(() => closing.delete(finished));
      }
    } };
  };
  return {
    async query(filters, queryOptions) {
      const scope = acquire(filters);
      try { return await scope.runtime.query(filters, queryOptions); }
      finally { scope.release(); }
    },
    subscribe(filters, handlers, subscribeOptions) {
      const scope = acquire(filters);
      try {
        const subscription = scope.runtime.subscribe(filters, handlers, subscribeOptions);
        const close = () => {
          subscribeOptions?.signal?.removeEventListener('abort', close);
          subscription.close(); scope.release();
        };
        subscribeOptions?.signal?.addEventListener('abort', close, { once: true });
        if (subscribeOptions?.signal?.aborted) close();
        return { close };
      } catch (error) { scope.release(); throw error; }
    },
    setRelays(urls) {
      if (stopped) throw new Error('Discovery is closed');
      relays = [...urls];
      for (const scope of scopes.values()) scope.runtime.setRelays(urls);
    },
    getRelayStats: () => [...scopes.values()].flatMap(scope => scope.runtime.getRelayStats()),
    async close() {
      stopped = true;
      const pending = [...scopes.values()].map(scope => scope.runtime.close());
      scopes.clear();
      await Promise.all([...pending, ...closing]);
    },
  };
}
