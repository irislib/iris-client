import {AppEvent} from "@/lib/nostr"
import {EmbedEvent} from "../components/embed"

export interface ImetaMediaItem {
  url: string
  type: "image" | "video"
  imeta?: string[]
}

export interface ImetaData {
  url?: string
  mimeType?: string
  dimensions?: string
  width?: number
  height?: number
  blurhash?: string
  name?: string
  size?: number
  alt?: string
}

/**
 * Parses an imeta tag and extracts all metadata
 */
export function parseImetaTag(tag: string[]): ImetaData {
  const data: ImetaData = {}

  for (const item of tag) {
    if (item.startsWith("url ")) {
      data.url = item.slice(4)
    } else if (item.startsWith("m ")) {
      data.mimeType = item.slice(2)
    } else if (item.startsWith("dim ")) {
      data.dimensions = item.slice(4)
      const [width, height] = data.dimensions.split("x").map(Number)
      data.width = width
      data.height = height
    } else if (item.startsWith("blurhash ")) {
      data.blurhash = item.slice(9)
    } else if (item.startsWith("name ")) {
      data.name = item.slice(5)
    } else if (item.startsWith("size ")) {
      data.size = parseInt(item.slice(5))
    } else if (item.startsWith("alt ")) {
      data.alt = item.slice(4)
    }
  }

  return data
}

/**
 * Extracts media items from imeta tags in an event
 */
export function extractImetaImages(event: AppEvent): ImetaMediaItem[] {
  return event.tags
    .filter((tag) => tag[0] === "imeta")
    .map((tag) => {
      const data = parseImetaTag(tag.slice(1))

      if (!data.url || !data.mimeType?.startsWith("image/")) {
        return null
      }

      return {
        url: data.url,
        type: "image" as const,
        imeta: tag.slice(1), // Remove "imeta" from the start
      }
    })
    .filter(Boolean) as ImetaMediaItem[]
}

/**
 * Gets parsed imeta data for a specific URL
 */
export function getImetaDataForUrl(
  event: AppEvent | EmbedEvent,
  url: string
): ImetaData | undefined {
  if (!event?.tags) return undefined
  const tag = event.tags.find(
    (tag) => tag[0] === "imeta" && tag[1] && tag[1].includes(url)
  )
  return tag ? parseImetaTag(tag.slice(1)) : undefined
}
