import {useCallback, useEffect, useState} from "react"
import {verifyEvent, type Event} from "nostr-tools"
import {NDKSubscriptionCacheUsage, type NDKEvent, type NDKSubscription} from "@/lib/ndk"
import {ndk} from "@/utils/ndk"
import {
  parsePollResponse,
  pollResponseQueries,
  POLL_RESPONSES_PER_KEY,
  type Poll,
  type PollEvent,
} from "../polls"

const LIMIT = 5000

/** Batch per-key history, then keep one live query; memory stores one valid vote per key. */
export default function usePollResponses(poll: Poll | null, closed: boolean) {
  const [revision, setRevision] = useState(0)
  const [responses, setResponses] = useState<PollEvent[]>([])
  const [loading, setLoading] = useState(false)
  const [limited, setLimited] = useState(false)
  const [error, setError] = useState("")
  const relayKey = JSON.stringify(poll?.relays ?? [])

  useEffect(() => {
    setResponses([])
    setError("")
    setLimited(false)
    if (!poll) return
    setLoading(true)
    const latest = new Map<string, PollEvent>()
    const receivedByKey = new Map<string, number>()
    const subscriptions = new Set<NDKSubscription>()
    const timers = new Set<ReturnType<typeof setTimeout>>()
    let received = 0
    let batch: ReturnType<typeof setTimeout> | undefined
    let active = true
    const flush = () => {
      clearTimeout(batch)
      batch = undefined
      if (active) setResponses([...latest.values()])
    }
    if (poll.relays.length > 8) setLimited(true)
    const options = {
      cacheUsage: NDKSubscriptionCacheUsage.PARALLEL,
      ...(poll.relays.length ? {relayUrls: poll.relays.slice(0, 8)} : {}),
    }
    const {history, live} = pollResponseQueries(poll)
    const allowed = live.authors ? new Set(live.authors) : undefined
    const onEvent = (event: NDKEvent, historical: boolean) => {
      if (!active) return
      const raw = event.rawEvent() as Event
      if (allowed && !allowed.has(raw.pubkey)) return
      if (historical) {
        received++
        const perKey = (receivedByKey.get(raw.pubkey) ?? 0) + 1
        receivedByKey.set(raw.pubkey, perKey)
        if (
          (poll.electorate && perKey >= POLL_RESPONSES_PER_KEY) ||
          (!poll.electorate && received >= LIMIT)
        )
          setLimited(true)
      }
      if (!parsePollResponse(poll, raw) || !verifyEvent(raw)) return
      const previous = latest.get(raw.pubkey)
      if (
        previous &&
        (previous.created_at! > raw.created_at ||
          (previous.created_at === raw.created_at && previous.id <= raw.id))
      )
        return
      if (!previous && latest.size >= LIMIT) {
        setLimited(true)
        return
      }
      latest.set(raw.pubkey, raw)
      if (!batch) batch = setTimeout(flush, 50)
    }
    // Start live delivery before the historical scan so votes cast during it are retained.
    if (!closed) {
      const subscription = ndk().subscribe(
        {...live, since: Math.floor(Date.now() / 1000)},
        {...options, closeOnEose: false},
        false
      )
      subscriptions.add(subscription)
      subscription.on("event", (event) => onEvent(event, false))
      subscription.start()
    }
    let next = 0
    let running = 0
    const runNext = () => {
      if (!active) return
      while (running < 2 && next < history.length) {
        const filters = history[next++]
        running++
        const subscription = ndk().subscribe(
          filters,
          {...options, closeOnEose: true},
          false
        )
        subscriptions.add(subscription)
        let finished = false
        const finish = (timedOut: boolean) => {
          if (finished || !active) return
          finished = true
          clearTimeout(timeout)
          timers.delete(timeout)
          subscription.stop()
          subscriptions.delete(subscription)
          running--
          if (timedOut)
            setError("Some relays have not responded. Results may be incomplete.")
          flush()
          if (next === history.length && !running) setLoading(false)
          runNext()
        }
        const timeout = setTimeout(() => finish(true), 12_000)
        timers.add(timeout)
        subscription.on("event", (event) => onEvent(event, true))
        subscription.on("eose", () => finish(false))
        subscription.start()
      }
    }
    runNext()
    return () => {
      active = false
      for (const timer of timers) clearTimeout(timer)
      clearTimeout(batch)
      for (const subscription of subscriptions) subscription.stop()
    }
    // Signed poll content is immutable; identity plus relay hints scopes this subscription.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [poll?.id, relayKey, revision, closed])

  const refresh = useCallback(() => setRevision((value) => value + 1), [])
  return {responses, loading, limited, error, refresh}
}
