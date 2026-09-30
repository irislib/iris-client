import {CustomEmojiComponent} from "../../embed/nostr/CustomEmojiComponent"
import {AppEvent} from "@/lib/nostr"

export function ReactionContent({content, event}: {content: string; event: AppEvent}) {
  if (content === "+") return "❤️"

  // Check if the content contains emoji shortcodes
  const emojiRegex = /:([a-zA-Z0-9_-]+):/g
  if (emojiRegex.test(content)) {
    const shortcode = content.replace(/:/g, "")
    return <CustomEmojiComponent match={shortcode} event={event} />
  }

  return content
}
