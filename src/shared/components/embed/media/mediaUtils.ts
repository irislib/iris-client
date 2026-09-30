import {decode, encode} from "blurhash"
import {AppEvent} from "@/lib/nostr"
import {EmbedEvent} from "../index"
import {SwipeItem} from "@/shared/hooks/useSwipable"

export interface Dimensions {
  width: string
  height: string
}

export interface ImageMetadata {
  width: number
  height: number
  blurhash: string
}

export const calculateDimensions = (
  originalWidth: number | null,
  originalHeight: number | null,
  limitHeight?: boolean
): Dimensions | undefined => {
  if (!originalWidth || !originalHeight) return undefined

  const maxWidth = Math.min(650, window.innerWidth)
  const maxHeight = limitHeight ? 600 : window.innerHeight * 0.9

  let width = originalWidth
  let height = originalHeight

  // Scale down if width exceeds max
  if (width > maxWidth) {
    const ratio = maxWidth / width
    width = maxWidth
    height = Math.round(height * ratio)
  }

  // Scale down if height exceeds max
  if (height > maxHeight) {
    const ratio = maxHeight / height
    height = maxHeight
    width = Math.round(width * ratio)
  }

  return {width: `${width}px`, height: `${height}px`}
}

export const generateBlurhashUrl = (
  blurhash: string | undefined,
  calculatedDimensions: Dimensions | undefined
): string | null => {
  if (!blurhash || !calculatedDimensions) return null

  // Use smaller dimensions for blurhash preview (max 32px)
  const maxPreviewSize = 32
  const originalWidth = parseInt(calculatedDimensions.width)
  const originalHeight = parseInt(calculatedDimensions.height)
  let width = originalWidth
  let height = originalHeight

  // Scale down if either dimension exceeds maxPreviewSize
  if (width > maxPreviewSize || height > maxPreviewSize) {
    const ratio = Math.min(maxPreviewSize / width, maxPreviewSize / height)
    width = Math.round(width * ratio)
    height = Math.round(height * ratio)
  }

  let pixels
  try {
    pixels = decode(blurhash, width, height)
  } catch (error) {
    console.error("Failed to decode blurhash:", error)
    return null
  }

  const canvas = document.createElement("canvas")
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext("2d")
  if (!ctx) return null
  const imageData = ctx.createImageData(width, height)
  imageData.data.set(pixels)
  ctx.putImageData(imageData, 0, 0)
  return canvas.toDataURL()
}

export async function calculateImageMetadata(file: File): Promise<ImageMetadata | null> {
  if (!file.type.startsWith("image/")) {
    return null
  }

  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement("canvas")
      const ctx = canvas.getContext("2d")
      if (!ctx) {
        resolve(null)
        return
      }

      // Set canvas size to a reasonable size for blurhash calculation
      const maxSize = 32
      let width = img.width
      let height = img.height

      // Scale down if either dimension exceeds maxSize
      if (width > maxSize || height > maxSize) {
        const ratio = Math.min(maxSize / width, maxSize / height)
        width = Math.round(width * ratio)
        height = Math.round(height * ratio)
      }

      canvas.width = width
      canvas.height = height
      ctx.drawImage(img, 0, 0, width, height)

      const imageData = ctx.getImageData(0, 0, width, height)
      const blurhash = encode(imageData.data, width, height, 4, 3)

      resolve({
        width: img.width,
        height: img.height,
        blurhash,
      })
    }
    img.onerror = () => resolve(null)
    img.src = URL.createObjectURL(file)
  })
}

export async function calculateVideoMetadata(file: File): Promise<ImageMetadata | null> {
  if (!file.type.startsWith("video/")) {
    return null
  }

  return new Promise((resolve) => {
    const video = document.createElement("video")
    video.preload = "metadata"

    video.onloadedmetadata = () => {
      const canvas = document.createElement("canvas")
      const ctx = canvas.getContext("2d")
      if (!ctx) {
        resolve(null)
        return
      }

      // Set canvas size to a reasonable size for blurhash calculation
      const maxSize = 32
      let width = video.videoWidth
      let height = video.videoHeight

      // Scale down if either dimension exceeds maxSize
      if (width > maxSize || height > maxSize) {
        const ratio = Math.min(maxSize / width, maxSize / height)
        width = Math.round(width * ratio)
        height = Math.round(height * ratio)
      }

      canvas.width = width
      canvas.height = height

      // Seek to the first frame
      video.currentTime = 0
    }

    video.onseeked = () => {
      const canvas = document.createElement("canvas")
      const ctx = canvas.getContext("2d")
      if (!ctx) {
        resolve(null)
        return
      }

      // Draw the first frame
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height)

      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
      const blurhash = encode(imageData.data, canvas.width, canvas.height, 4, 3)

      resolve({
        width: video.videoWidth,
        height: video.videoHeight,
        blurhash,
      })
    }

    video.onerror = () => resolve(null)
    video.src = URL.createObjectURL(file)
  })
}

function isNDKEvent(event: EmbedEvent): event is AppEvent {
  return event && typeof (event as AppEvent).rawEvent !== "undefined"
}

/**
 * Extracts all media URLs (images and videos) from an event
 */
export const getAllEventMedia = (event: EmbedEvent | undefined): SwipeItem[] => {
  if (!event || !event.content) return []

  const mediaItems: SwipeItem[] = []
  const content = event.content

  // Regex patterns for images and videos
  const imageRegex =
    /(https?:\/\/[^\s]+?\.(?:jpg|jpeg|png|gif|webp)(?:\?[^\s#]*)?(?:#[^\s]*)?)/gi
  const videoRegex =
    /(https?:\/\/[^\s]+?\.(?:mp4|webm|ogg|mov|m3u8)(?:\?[^\s#]*)?(?:#[^\s]*)?)/gi

  // Find all image matches
  let match
  while ((match = imageRegex.exec(content)) !== null) {
    mediaItems.push({
      url: match[1],
      type: "image",
    })
  }

  // Find all video matches
  while ((match = videoRegex.exec(content)) !== null) {
    mediaItems.push({
      url: match[1],
      type: "video",
    })
  }

  // For market listings (kind 30402), also check image tags
  if (isNDKEvent(event) && event.kind === 30402) {
    const imageTags = event.tags.filter((tag) => tag[0] === "image")
    imageTags.forEach((tag) => {
      const url = tag[1]
      // Only add if not already present
      if (!mediaItems.some((item) => item.url === url)) {
        mediaItems.push({
          url: url,
          type: "image",
        })
      }
    })
  }

  return mediaItems
}
