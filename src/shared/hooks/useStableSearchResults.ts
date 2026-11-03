import {useLayoutEffect, useMemo, useRef, useState} from "react"
import type {AppEvent} from "@/lib/nostr"

interface Results {
  primary: AppEvent[]
  additional: Map<string, AppEvent[]>
}

// Only rows already offered to the reader are locked. New authors and subsequent
// pages use the latest scores, and posts removed by visibility filters disappear.
export function useStableSearchResults(
  primary: AppEvent[],
  additional: Map<string, AppEvent[]>,
  scope: string | undefined,
  displayCount: number
) {
  const [revision, setRevision] = useState(0)
  const committed = useRef<(Results & {scope: string; revision: number}) | null>(null)
  const view = useMemo(() => {
    const previous = committed.current
    if (!scope || previous?.scope !== scope || previous.revision !== revision) {
      return {primary, additional, hasUpdates: false}
    }
    const eligible = new Map(primary.map((post) => [post.id, post]))
    for (const posts of additional.values()) {
      for (const post of posts) eligible.set(post.id, post)
    }
    const locked = new Set<string>()
    const rows: AppEvent[] = []
    const groups = new Map(additional)
    let hasUpdates = false
    for (const old of previous.primary) {
      const current = eligible.get(old.id)
      if (!current) continue
      locked.add(current.pubkey)
      if (primary[rows.length]?.id !== current.id) hasUpdates = true
      rows.push(current)
      const children = (previous.additional.get(current.pubkey) ?? []).flatMap((post) => {
        const visible = eligible.get(post.id)
        return visible ? [visible] : []
      })
      const latest = additional.get(current.pubkey) ?? []
      if (
        children.length !== latest.length ||
        children.some((p, i) => p.id !== latest[i].id)
      ) {
        hasUpdates = true
      }
      groups.set(current.pubkey, children)
    }
    if (!hasUpdates) return {primary, additional, hasUpdates}
    for (const post of primary) {
      if (!locked.has(post.pubkey)) rows.push(post)
    }
    return {primary: rows, additional: groups, hasUpdates}
  }, [primary, additional, revision, scope])

  useLayoutEffect(() => {
    committed.current = scope
      ? {
          scope,
          revision,
          primary: view.primary.slice(0, displayCount),
          additional: view.additional,
        }
      : null
  }, [view, displayCount, scope, revision])

  return {...view, applyUpdates: () => setRevision((v) => v + 1)}
}
