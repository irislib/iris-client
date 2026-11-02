import {useEffect, useMemo, useRef, useState} from "react"
import type {AppEvent} from "@/lib/nostr"
import {
  authorSignal,
  cachedLexicalMatch,
  rankCandidates,
  planPostSearch,
  type SearchPlan,
} from "@/lib/post-search/ranking"
import {createPostScorer, type SearchSettings} from "@/lib/post-search/scorer"
import type {SocialGraph} from "nostr-social-graph"

export function usePostRelevance(
  plan: SearchPlan | undefined,
  settings: SearchSettings | undefined,
  events: AppEvent[],
  graph: SocialGraph,
  revision: string,
  discoveryDistance?: (pubkey: string) => number
) {
  const pageSize = settings?.model === "minilm" ? 64 : 16
  const [budget, setBudget] = useState(pageSize)
  const [version, update] = useState(0)
  const [relatedTerms, setRelatedTerms] = useState<string[]>([])
  const [status, setStatus] = useState("")
  const scores = useMemo(() => new Map<string, number>(), [plan, settings])
  const lexical = useMemo(() => plan && cachedLexicalMatch(plan), [plan])
  const discovery = useMemo(
    () =>
      relatedTerms.length
        ? cachedLexicalMatch(planPostSearch(relatedTerms.join(" ")))
        : undefined,
    [relatedTerms]
  )
  const authors = useMemo(
    () => new Map<string, number>(),
    [revision, graph, discoveryDistance]
  )
  const candidates = useMemo(() => {
    if (!lexical) return []
    return events.flatMap((event) => {
      const match = lexical(event)
      if (match < 0) return []
      let author = authors.get(event.pubkey)
      if (author === undefined) {
        author = authorSignal(
          discoveryDistance?.(event.pubkey) ?? graph.getFollowDistance(event.pubkey),
          graph.getFollowersByUser(event.pubkey).size
        )
        authors.set(event.pubkey, author)
      }
      return [{event, lexical: match, author, discovery: discovery?.(event) ?? 0}]
    })
  }, [events, graph, authors, discoveryDistance, lexical, discovery])
  const ranked = useMemo(
    () => rankCandidates(candidates, scores, Date.now() / 1000),
    [candidates, scores, version]
  )

  const limit =
    budget + Math.min(pageSize / 4, candidates.filter((row) => row.discovery > 0).length)
  const budgetRef = useRef(limit)
  budgetRef.current = limit
  const shortlist = useMemo(() => {
    if (!plan?.terms.length) return []
    const ordered = [...candidates].sort(
      (a, b) =>
        Math.max(b.lexical, b.discovery * 0.75) -
          Math.max(a.lexical, a.discovery * 0.75) ||
        b.author - a.author ||
        (b.event.created_at ?? 0) - (a.event.created_at ?? 0)
    )
    // Reserve places for paraphrases from the recent-note source and for distinct authors.
    const buckets: AppEvent[][] = [[], [], [], []]
    const seen = new Set<string>()
    for (const {event, lexical, discovery} of ordered) {
      buckets[(seen.has(event.pubkey) ? 2 : 0) + (lexical || discovery ? 0 : 1)].push(
        event
      )
      seen.add(event.pubkey)
    }
    const result: AppEvent[] = []
    for (const pair of [buckets.slice(0, 2), buckets.slice(2)]) {
      for (
        let i = 0;
        i < Math.max(pair[0].length, pair[1].length) && result.length < limit;
        i++
      ) {
        for (const bucket of pair)
          if (bucket[i] && result.length < limit) result.push(bucket[i])
      }
    }
    return result
  }, [candidates, plan, limit])
  const latest = useRef(shortlist)
  latest.current = shortlist
  const kick = useRef<() => void>(() => {})
  useEffect(() => {
    if (!plan?.terms.length || !settings) return
    const controller = new AbortController()
    const score = createPostScorer(settings, plan.text, controller.signal, (terms) => {
      if (controller.signal.aborted) return
      const excluded = new Set(
        [...plan.terms, ...plan.hashtags].map((t) => t.toLowerCase())
      )
      const valid = terms
        .filter((t) => typeof t === "string")
        .map((t) => t.trim().toLowerCase())
        .filter((t) => /^[\p{L}\p{N}][\p{L}\p{N}_ -]{1,38}$/u.test(t) && !excluded.has(t))
      setRelatedTerms([...new Set(valid)].slice(0, 2))
    })
    let planned = false
    let running = false,
      spent = 0
    const run = async () => {
      if (running || controller.signal.aborted) return
      running = true
      try {
        if (!planned) {
          planned = true
          setStatus("Ranking posts…")
          await score([])
        }
        while (!controller.signal.aborted) {
          const batch = latest.current
            .filter((e) => !scores.has(e.id))
            .slice(0, Math.max(0, Math.min(4, budgetRef.current - spent)))
          if (!batch.length) break
          setStatus("Ranking posts…")
          const results = await score(
            batch.map((e) =>
              [e.content, ...e.tags.filter((t) => t[0] === "t").map((t) => "#" + t[1])]
                .join(" ")
                .slice(0, 1800)
            )
          )
          if (controller.signal.aborted) return
          if (
            results.length !== batch.length ||
            !results.every((s) => Number.isFinite(s) && s >= 0 && s <= 1)
          )
            throw Error("Invalid scores")
          batch.forEach((e, i) => scores.set(e.id, results[i]))
          spent += batch.length
          update((v) => v + 1)
        }
        if (!controller.signal.aborted) setStatus("")
      } catch {
        if (!controller.signal.aborted) {
          setStatus(
            settings.model === "ollama"
              ? "Ollama unavailable · using text and network relevance"
              : settings.model === "browser"
                ? "Browser AI unavailable · using text and network relevance"
                : "AI unavailable · using text and network relevance"
          )
          controller.abort()
        }
      } finally {
        running = false
      }
    }
    kick.current = () => {
      void run()
    }
    return () => {
      controller.abort()
      kick.current = () => {}
    }
  }, [settings, plan, scores])
  useEffect(() => {
    if (!plan?.terms.length) return
    const timer = setTimeout(() => kick.current(), 80)
    return () => clearTimeout(timer)
  }, [shortlist, plan, settings])

  return {
    ...ranked,
    status,
    relatedTerms,
    moreToScore:
      !!plan?.terms.length &&
      candidates.length > limit &&
      !status.includes("unavailable"),
    increaseBudget: () => setBudget((b) => b + pageSize),
  }
}
