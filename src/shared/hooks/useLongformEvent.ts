import {AppEvent} from "@/lib/nostr"
import {useState, useEffect} from "react"
import {nip19} from "nostr-tools"
import {nostr} from "@/utils/nostrClient"

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

    nostr()
      .fetchEvent({
        authors: [naddrData.pubkey],
        kinds: [naddrData.kind],
        "#d": [naddrData.identifier],
      })
      .then((fetchedEvent) => {
        if (fetchedEvent) {
          setEvent(fetchedEvent)
          setError(null)
        } else {
          setError("Event not found")
          setEvent(null)
        }
        setLoading(false)
      })
      .catch((err) => {
        console.warn("Error fetching longform event:", err)
        setError("Failed to fetch event")
        setEvent(null)
        setLoading(false)
      })
  }, [naddrData])

  return {event, loading, error}
}
