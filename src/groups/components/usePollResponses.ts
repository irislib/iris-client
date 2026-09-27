import {useCallback, useEffect, useState} from "react"
import {verifyEvent, type Event} from "nostr-tools"
import {NDKSubscriptionCacheUsage} from "@/lib/ndk"
import {ndk} from "@/utils/ndk"
import {KIND_POLL_RESPONSE, parsePollResponse, type Poll, type PollEvent} from "../polls"

const LIMIT = 5000

/** Bounded, batched results with one stored valid response per key. */
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
    let received = 0
    let batch: ReturnType<typeof setTimeout> | undefined
    let active = true
    const flush = () => {
      clearTimeout(batch)
      batch = undefined
      if (active) setResponses([...latest.values()])
    }
    // Limit untrusted relay hints as well as the result set.
    if (poll.relays.length > 8) setLimited(true)
    const sub = ndk().subscribe(
      {
        kinds: [KIND_POLL_RESPONSE],
        "#e": [poll.id],
        since: poll.createdAt,
        ...(poll.endsAt !== undefined ? {until: poll.endsAt} : {}),
        limit: LIMIT,
      },
      {
        closeOnEose: closed,
        cacheUsage: NDKSubscriptionCacheUsage.PARALLEL,
        ...(poll.relays.length ? {relayUrls: poll.relays.slice(0, 8)} : {}),
      },
      false
    )
    sub.on("event", (event) => {
      const raw = event.rawEvent() as Event
      received++
      if (received >= LIMIT) setLimited(true)
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
    })
    const timeout = setTimeout(() => {
      if (!active) return
      setLoading(false)
      setError("Some relays have not responded. Results may be incomplete.")
    }, 12_000)
    sub.on("eose", () => {
      clearTimeout(timeout)
      if (!active) return
      setLoading(false)
      setError("")
      flush()
    })
    sub.start()
    return () => {
      active = false
      clearTimeout(timeout)
      clearTimeout(batch)
      sub.stop()
    }
    // Signed poll content is immutable; identity plus relay hints scopes this subscription.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [poll?.id, relayKey, revision, closed])

  const refresh = useCallback(() => setRevision((value) => value + 1), [])
  return {responses, loading, limited, error, refresh}
}
