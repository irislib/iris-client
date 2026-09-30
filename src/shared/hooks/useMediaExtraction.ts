import {useCallback, useRef} from "react"
import {AppEvent} from "@/lib/nostr"
import {IMAGE_REGEX, VIDEO_REGEX} from "@/shared/components/embed/media/MediaEmbed"
import {KIND_PICTURE_FIRST} from "@/utils/constants"
import {extractImetaImages} from "@/shared/utils/imetaUtils"

export interface MediaItem {
  type: "image" | "video"
  url: string
  event: AppEvent
}

export function useMediaExtraction() {
  // Cache for parsed media from events to avoid re-parsing
  const mediaCache = useRef(new Map<string, MediaItem[]>())

  const extractMediaFromEvent = useCallback((event: AppEvent): MediaItem[] => {
    // Check cache first
    if (mediaCache.current.has(event.id)) {
      return mediaCache.current.get(event.id)!
    }

    const media: MediaItem[] = []

    // Handle kind 20 (picture-first) events
    if (event.kind === KIND_PICTURE_FIRST) {
      const images = extractImetaImages(event)
      images.forEach((img) => {
        media.push({type: "image" as const, url: img.url, event})
      })
    }
    // Handle other events with media in content
    else if (
      event.content &&
      (event.content.includes("http") || event.content.includes("."))
    ) {
      const imageMatches = event.content.match(IMAGE_REGEX) || []
      const videoMatches = event.content.match(VIDEO_REGEX) || []

      imageMatches.forEach((match) =>
        match
          .trim()
          .split(/\s+/)
          .forEach((url) => {
            media.push({type: "image" as const, url, event})
          })
      )

      videoMatches.forEach((match) =>
        match
          .trim()
          .split(/\s+/)
          .forEach((url) => {
            media.push({type: "video" as const, url, event})
          })
      )
    }

    // Cache the result (limit cache size to prevent memory leaks)
    if (mediaCache.current.size > 200) {
      const firstKey = mediaCache.current.keys().next().value
      if (firstKey) {
        mediaCache.current.delete(firstKey)
      }
    }
    mediaCache.current.set(event.id, media)

    return media
  }, [])

  const calculateAllMedia = useCallback(
    (events: AppEvent[]): MediaItem[] => {
      const deduplicated = new Map<string, MediaItem>()

      // Use cached extraction
      events.forEach((event) => {
        const eventMedia = extractMediaFromEvent(event)
        eventMedia.forEach((item) => {
          const uniqueId = `${event.id}_${item.url}`
          if (!deduplicated.has(uniqueId)) {
            deduplicated.set(uniqueId, item)
          }
        })
      })

      return Array.from(deduplicated.values())
    },
    [extractMediaFromEvent]
  )

  const clearCache = useCallback(() => {
    mediaCache.current.clear()
  }, [])

  return {
    extractMediaFromEvent,
    calculateAllMedia,
    clearCache,
  }
}
