import {AppEvent} from "@/lib/nostr"
import {useEffect, useMemo, useState} from "react"
import {shouldHideUser} from "@/utils/visibility"
import {nostr} from "@/utils/nostrClient"
import {useGroupAccess} from "@/groups/GroupContext"
import {isVisibleGroupActivity} from "@/groups/activity"
import {useGroupActivity} from "@/groups/useGroupActivity"

export interface ReactionInfo {
  emoji: string
  pubkeys: Set<string>
  event?: AppEvent
  isCustom?: boolean
  emojiUrl?: string
}

/**
 * Hook to fetch and deduplicate reaction events for an event
 * Only keeps the latest reaction per author
 * Returns a map of author pubkey to their latest reaction event
 */
export function useReactionsByAuthor(eventId: string) {
  const group = useGroupAccess()
  const memberReactions = useGroupActivity([{kinds: [7], "#e": [eventId]}], 1)
  const [reactionsByAuthor, setReactionsByAuthor] = useState<Map<string, AppEvent>>(
    new Map()
  )

  useEffect(() => {
    setReactionsByAuthor(new Map())
    if (group) return
    const filter = {
      kinds: [7],
      ["#e"]: [eventId],
    }

    // Group activity stays live; ordinary feeds close at EOSE to bound subscriptions.
    const sub = nostr().subscribe(filter, {closeOnEose: !group})

    sub?.on("event", (reactionEvent: AppEvent) => {
      if (shouldHideUser(reactionEvent.pubkey)) return

      const authorPubkey = reactionEvent.pubkey

      // Update author's latest reaction
      setReactionsByAuthor((prev) => {
        const existing = prev.get(authorPubkey)
        if (existing && existing.created_at! >= reactionEvent.created_at!) {
          // We already have a newer reaction from this author
          return prev
        }

        const newMap = new Map(prev)
        newMap.set(authorPubkey, reactionEvent)
        return newMap
      })
    })

    return () => {
      sub.stop()
    }
  }, [eventId, group?.ref.id, group?.ref.creator])

  return useMemo(
    () =>
      new Map(
        (group
          ? memberReactions
              .filter((event) => !shouldHideUser(event.pubkey))
              .map((event) => [event.pubkey, event] as const)
          : [...reactionsByAuthor]
        ).filter(([, event]) => isVisibleGroupActivity(event, group))
      ),
    [reactionsByAuthor, memberReactions, group]
  )
}

/**
 * Hook to fetch reactions grouped by emoji
 * Only keeps the latest reaction per author
 */
export function useReactions(eventId: string) {
  const reactionsByAuthor = useReactionsByAuthor(eventId)

  // Derive directly so a membership change cannot leave stale grouped counts.
  return useMemo(() => {
    const newReactions = new Map<string, ReactionInfo>()

    for (const reactionEvent of reactionsByAuthor.values()) {
      const content = reactionEvent.content || "+"

      // Check if it's a custom emoji
      const customEmojiMatch = content.match(/^:([a-zA-Z0-9_-]+):$/)
      let key = content
      let emojiUrl: string | undefined
      let isCustom = false
      let displayEmoji = content

      if (customEmojiMatch) {
        const shortcode = customEmojiMatch[1]
        const emojiTag = reactionEvent.tags.find(
          (tag) => tag[0] === "emoji" && tag[1] === shortcode && tag[2]
        )

        if (emojiTag && emojiTag[2]) {
          // Key by URL for custom emojis to group them properly
          key = emojiTag[2]
          emojiUrl = emojiTag[2]
          isCustom = true
          displayEmoji = content
        }
      }

      const existing = newReactions.get(key) || {
        emoji: displayEmoji,
        pubkeys: new Set(),
        event: reactionEvent,
        isCustom,
        emojiUrl,
      }
      existing.pubkeys.add(reactionEvent.pubkey)
      newReactions.set(key, existing)
    }

    return newReactions
  }, [reactionsByAuthor])
}
