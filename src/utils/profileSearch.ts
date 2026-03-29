import {NDKUserProfile} from "@/lib/ndk"
import {getWorkerTransport} from "@/utils/ndk"
import type {SearchResult} from "@/utils/profileSearchData"

export type {SearchResult} from "@/utils/profileSearchData"

// Profile events are now handled directly in relay-worker when kind 0 events arrive
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function handleProfile(pubKey: string, profile: NDKUserProfile) {}

export function search(
  query: string,
  onUpdate?: (
    results: Array<{item: SearchResult; score?: number; source?: "local" | "remote"}>
  ) => void
): Promise<Array<{item: SearchResult; score?: number; source?: "local" | "remote"}>> {
  const transport = getWorkerTransport()
  if (!transport) {
    return Promise.resolve([])
  }
  return transport.search(query, onUpdate)
}
