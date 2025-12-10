import {NDKEvent} from "@/lib/ndk"
import {useEffect, useState} from "react"
import {shouldHideUser} from "@/utils/visibility"
import {ndk} from "@/utils/ndk"

export interface ReactionInfo {
  emoji: string
  pubkeys: Set<string>
  event?: NDKEvent
  isCustom?: boolean
  emojiUrl?: string
}

/**
 * Hook to fetch and deduplicate reaction events for an event
 * Only keeps the latest reaction per author
 * Returns a map of author pubkey to their latest reaction event
 */
export function useReactionsByAuthor(eventId: string) {
  const [reactionsByAuthor, setReactionsByAuthor] = useState<Map<string, NDKEvent>>(
    new Map()
  )

  useEffect(() => {
    const filter = {
      kinds: [7],
      ["#e"]: [eventId],
    }

    // Closed on eose because NDK will otherwise send too many concurrent REQs for all the feed item reaction subscriptions
    const sub = ndk().subscribe(filter, {closeOnEose: true})

    sub?.on("event", (reactionEvent: NDKEvent) => {
      if (shouldHideUser(reactionEvent.author.pubkey)) return

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
  }, [eventId])

  return reactionsByAuthor
}

/**
 * Hook to fetch reactions grouped by emoji
 * Only keeps the latest reaction per author
 */
export function useReactions(eventId: string) {
  const [reactions, setReactions] = useState<Map<string, ReactionInfo>>(new Map())
  const reactionsByAuthor = useReactionsByAuthor(eventId)

  // Process reactions by author into grouped reactions by emoji
  useEffect(() => {
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

    setReactions(newReactions)
  }, [reactionsByAuthor])

  return reactions
}
