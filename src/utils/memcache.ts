import {NDKEvent, NDKUserProfile} from "@nostr-dev-kit/ndk"
import {SortedMap} from "./SortedMap/SortedMap"
import {LRUCache} from "typescript-lru-cache"
import debounce from "lodash/debounce"
import localforage from "localforage"

export const eventsByIdCache = new LRUCache({maxSize: 2000})
export const feedCache = new LRUCache<string, SortedMap<string, NDKEvent>>({maxSize: 50})
export const seenEventIds = new LRUCache<string, boolean>({maxSize: 20000})
export const profileCache = new LRUCache<string, NDKUserProfile>({maxSize: 100000})

// Cache for NIP-05 verification results
export const nip05VerificationCache = new LRUCache<string, boolean>({maxSize: 1000})

localforage
  .getItem<string[]>("seenEventIds")
  .then((s) => {
    if (s) {
      s.forEach((id) => seenEventIds.set(id, true))
    }
  })
  .catch((e) => {
    console.error("failed to load seenEventIds:", e)
  })

const debouncedSave = debounce(
  () => localforage.setItem("seenEventIds", [...seenEventIds.keys()]),
  5000
)

export const addSeenEventId = (id: string) => {
  seenEventIds.set(id, true)
  debouncedSave()
}
