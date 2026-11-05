import {
  splitRelayDiscoveryFilters,
  type NostrRuntime,
  type RuntimeCompletion,
  type NostrFilter,
  isPrivateRelayEvent,
} from "nostr-pubsub"

type Subscribe = NostrRuntime["subscribe"]
// This directory lists public groups without selecting any person's keys.
// The same fact kind is also used for private device discovery, which must
// retain the shared SDK's strict single-subject policy.
export function splitPrivateDiscoveryFilters(filters: NostrFilter[]) {
  const isPublicDirectory = (filter: NostrFilter) =>
    filter.kinds?.length === 1 &&
    filter.kinds[0] === 37368 &&
    filter["#t"]?.length === 1 &&
    filter["#t"][0] === "iris-group" &&
    Object.keys(filter).every((key) =>
      ["kinds", "#t", "limit", "since", "until"].includes(key)
    )
  const publicDirectories = filters.filter(isPublicDirectory)
  const split = splitRelayDiscoveryFilters(
    filters.filter((filter) => !isPublicDirectory(filter))
  )
  return {...split, receiver: [...publicDirectories, ...split.receiver]}
}

function completion(statuses: RuntimeCompletion[]): RuntimeCompletion {
  const sources = new Map<string, RuntimeCompletion["sources"]>()
  for (const status of statuses)
    for (const source of status.sources) {
      const previous = sources.get(source.id)
      if (previous) previous.push(source)
      else sources.set(source.id, [source])
    }
  const incomplete = statuses.find((status) => !status.complete)
  return {
    complete: !incomplete,
    reason:
      incomplete?.reason ??
      (statuses.every((status) => status.reason === "cache") ? "cache" : "eose"),
    sources: [...sources].map(([id, reports]) => ({
      id,
      complete: reports.every((report) => report.complete),
      ...(reports.some((report) => report.error)
        ? {
            error: [
              ...new Set(
                reports.flatMap((report) => (report.error ? [report.error] : []))
              ),
            ].join("; "),
          }
        : {}),
    })),
  }
}

export function privateDiscoverySubscribe(
  receiver: Subscribe,
  discovery: Subscribe,
  privateScope?: {receiver: Subscribe; discovery: Subscribe}
): Subscribe {
  return (filters, handlers, options = {}) => {
    const split = splitPrivateDiscoveryFilters(filters)
    const publicFilters: NostrFilter[] = []
    const privateFilters: NostrFilter[] = []
    for (const filter of split.receiver) {
      if (!privateScope) {
        publicFilters.push(filter)
        continue
      }
      if (!filter.kinds && filter["#p"]) {
        privateFilters.push(filter)
        continue
      }
      const privateKinds =
        filter.kinds?.filter((kind) => isPrivateRelayEvent({kind})) ?? []
      if (!privateKinds.length) {
        publicFilters.push(filter)
        continue
      }
      privateFilters.push({...filter, kinds: privateKinds})
      const publicKinds = filter.kinds!.filter((kind) => !isPrivateRelayEvent({kind}))
      if (publicKinds.length) publicFilters.push({...filter, kinds: publicKinds})
    }
    const routes = [
      ...(publicFilters.length ? [{subscribe: receiver, filters: publicFilters}] : []),
      ...(privateFilters.length
        ? [{subscribe: privateScope!.receiver, filters: privateFilters}]
        : []),
      ...split.discovery.map((filters) => ({
        subscribe:
          privateScope &&
          filters.some((filter) =>
            filter.kinds?.some((kind) => [1059, 10050, 30078, 37368].includes(kind))
          )
            ? privateScope.discovery
            : discovery,
        filters,
      })),
    ]
    if (!routes.length) return receiver(filters, handlers, options)
    if (routes.length === 1)
      return routes[0].subscribe(routes[0].filters, handlers, options)
    const statuses = new Map<number, RuntimeCompletion>()
    const seen = new Set<string>()
    const opened: Array<ReturnType<Subscribe>> = []
    let closed = false
    try {
      for (const [index, route] of routes.entries())
        opened.push(
          route.subscribe(
            route.filters,
            {
              onEvent: (event, info) => {
                if (closed || seen.has(event.id)) return
                seen.add(event.id)
                if (seen.size > 8192) seen.delete(seen.values().next().value!)
                handlers.onEvent(event, info)
              },
              onEose: (status) => {
                if (closed) return
                statuses.set(index, status)
                if (statuses.size === routes.length)
                  handlers.onEose?.(completion([...statuses.values()]))
              },
              onError: (error) => {
                if (!closed) handlers.onError?.(error)
              },
            },
            options
          )
        )
    } catch (error) {
      closed = true
      for (const subscription of opened) subscription.close()
      throw error
    }
    return {
      close: () => {
        closed = true
        for (const subscription of opened) subscription.close()
      },
    }
  }
}
