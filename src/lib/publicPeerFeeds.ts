import {
  verifyNostrEvent,
  type NostrEvent,
  type PublicPeerFeed,
  type PublicPeerFeedSource,
} from "nostr-pubsub"
import {useUserStore} from "@/stores/user"
import {hasWriteAccessForState} from "@/utils/auth"
import {nostr} from "@/utils/nostrClient"
import type {EventSubscription} from "./nostr"

const postKinds = [1, 6, 16, 20, 1111, 30023]
const notificationKinds = [1, 6, 7, 9735]
export const latestPosts: PublicPeerFeed = {type: "latest", kinds: postKinds}

/** The signed-in account owns these interests for its entire session. */
export function watchPublicPeerFeeds(
  feed: PublicPeerFeedSource,
  setAuthors: (authors: string[]) => void
): () => void {
  let owner = ""
  let contacts: EventSubscription | undefined
  let winner: NostrEvent | undefined
  const replace = () => {
    setAuthors(
      owner
        ? [
            owner,
            ...(winner?.tags ?? [])
              .filter((tag) => tag[0] === "p" && /^[0-9a-f]{64}$/.test(tag[1]))
              .map((tag) => tag[1]),
          ]
        : []
    )
    const next: PublicPeerFeed[] = [
      owner && winner
        ? {type: "following", owner, contacts: winner, kinds: postKinds}
        : latestPosts,
    ]
    if (owner) next.push({type: "notifications", owner, kinds: notificationKinds})
    void feed
      .replaceFeed(next)
      .catch((error) => console.warn("Public peer feed unavailable", error))
  }
  const sync = () => {
    const state = useUserStore.getState()
    const selected = hasWriteAccessForState(state) ? state.publicKey : ""
    if (owner === selected) return
    owner = selected
    contacts?.stop()
    contacts = undefined
    winner = undefined
    replace()
    if (!owner) return
    contacts = nostr().subscribe({kinds: [3], authors: [owner]})
    contacts.on("event", (event) => {
      const raw: NostrEvent = event.rawEvent()
      if (
        owner !== selected ||
        raw.kind !== 3 ||
        raw.pubkey !== owner ||
        (winner &&
          (raw.created_at < winner.created_at ||
            (raw.created_at === winner.created_at && raw.id >= winner.id)))
      )
        return
      try {
        winner = verifyNostrEvent(raw)
      } catch {
        return
      }
      replace()
    })
  }
  const stop = useUserStore.subscribe(sync)
  sync()
  return () => {
    stop()
    owner = ""
    contacts?.stop()
  }
}
