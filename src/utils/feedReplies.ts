import {parse} from "nostr-tools/nip10"

/** Replies need their thread context; mentions and quotes are standalone posts. */
export function isFeedReply(event: {kind: number; tags: string[][]}): boolean {
  return event.kind === 1111 || (event.kind === 1 && !!parse(event).reply)
}
