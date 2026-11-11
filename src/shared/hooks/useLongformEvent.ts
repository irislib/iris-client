import {AppEvent} from "@/lib/nostr"
import {useState, useEffect} from "react"
import {nip19} from "nostr-tools"
import {watchLatestEvent} from "@/utils/watchLatestEvent"

/**
 * Custom hook for fetching longform events with memcaching
 * Designed specifically for NIP-23 longform content articles
 */
export function useLongformEvent(naddrData: nip19.AddressPointer | null) {
  const [event, setEvent] = useState<AppEvent | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!naddrData) {
      setEvent(null)
      setLoading(false)
      setError(null)
      return
    }

    setLoading(true)
    setError(null)

    return watchLatestEvent(
      {
        authors: [naddrData.pubkey],
        kinds: [naddrData.kind],
        "#d": [naddrData.identifier],
      },
      (latest) => {
        setEvent(latest)
        setError(null)
        setLoading(false)
      },
      {relayHints: naddrData.relays},
      ({found}) => {
        if (found) return
        setError("Event not found")
        setLoading(false)
      }
    )
  }, [naddrData])

  return {event, loading, error}
}
