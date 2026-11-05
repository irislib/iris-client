import {useEffect, useState} from "react"
import {verifyEvent} from "nostr-tools"
import type {AppEvent} from "@/lib/nostr"
import {nostr} from "@/utils/nostrClient"
import {
  DISCOVERY_MAX_EVENTS_PER_AUTHOR,
  DISCOVERY_TIMEOUT_MS,
  selectSparseDiscoveryPosts,
} from "@/utils/sparseDiscovery"

export interface SparseDiscoveryCache {
  scopeKey?: string
  complete?: boolean
  events?: AppEvent[]
  until?: number
}

/** One bounded read per mounted graph snapshot. Existing feed sources never
 * wait for it, and a silent relay cannot keep this source pending forever. */
export default function useSparseDiscovery(
  cache: SparseDiscoveryCache,
  authors: string[],
  graphScope: string,
  enabled: boolean
) {
  const sourceKey = `${graphScope}:discovery-v1:${authors.join(",")}`
  const [result, setResult] = useState(() => ({
    scopeKey: sourceKey,
    complete: cache.scopeKey === sourceKey && !!cache.complete,
    events: cache.scopeKey === sourceKey ? cache.events || [] : [],
  }))

  useEffect(() => {
    if (!enabled || authors.length === 0) return
    if (cache.scopeKey === sourceKey && cache.complete) {
      setResult({scopeKey: sourceKey, complete: true, events: cache.events || []})
      return
    }
    const until =
      cache.scopeKey === sourceKey && cache.until
        ? cache.until
        : Math.floor(Date.now() / 1000)
    const since = until - 48 * 60 * 60
    cache.scopeKey = sourceKey
    cache.until = until
    cache.complete = false
    cache.events = []
    setResult({scopeKey: sourceKey, complete: false, events: []})
    const byAuthor = new Map<string, Map<string, AppEvent>>(
      authors.map((author) => [author, new Map()])
    )
    let closed = false
    const deadline = Date.now() + DISCOVERY_TIMEOUT_MS
    const sub = nostr().subscribe(
      authors.map((author) => ({
        authors: [author],
        kinds: [1],
        since,
        until,
        limit: DISCOVERY_MAX_EVENTS_PER_AUTHOR,
      })),
      {isolated: true}
    )
    const finish = () => {
      if (closed) return
      closed = true
      clearTimeout(timer)
      sub.stop()
      if (cache.scopeKey !== sourceKey) return
      const events = selectSparseDiscoveryPosts(
        authors,
        [...byAuthor.values()].flatMap((records) => [...records.values()])
      )
      cache.events = events
      cache.complete = true
      setResult({scopeKey: sourceKey, events, complete: true})
    }
    const timer = setTimeout(finish, DISCOVERY_TIMEOUT_MS)
    sub.on("event", (event: AppEvent) => {
      if (closed || Date.now() >= deadline) {
        finish()
        return
      }
      const records = byAuthor.get(event.pubkey)
      if (
        !records ||
        event.kind !== 1 ||
        event.created_at < since ||
        event.created_at > until ||
        records.has(event.id) ||
        !verifyEvent(event.rawEvent())
      )
        return
      records.set(event.id, event)
      // Relays may overlap or return different portions of their bounded
      // histories. Retain only the newest eight per author, at most 64 records.
      if (records.size > DISCOVERY_MAX_EVENTS_PER_AUTHOR) {
        const oldest = [...records.values()].sort(
          (a, b) => a.created_at - b.created_at || b.id.localeCompare(a.id)
        )[0]
        records.delete(oldest.id)
      }
    })
    sub.on("eose", finish)
    return () => {
      closed = true
      clearTimeout(timer)
      sub.stop()
    }
  }, [authors, cache, enabled, sourceKey])

  const active = enabled && authors.length > 0 && result.scopeKey === sourceKey
  return {
    sourceKey,
    enabled: enabled && authors.length > 0,
    ready: active && result.complete,
    events: active ? result.events : [],
  }
}
