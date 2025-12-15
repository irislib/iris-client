import {useNavigate} from "@/navigation"
import {useEffect, useState, useMemo, memo, MutableRefObject, useRef} from "react"
import {NDKEvent, NDKSubscription} from "@/lib/ndk"
import {decode} from "blurhash"
import {nip19} from "nostr-tools"

import {IMAGE_REGEX, VIDEO_REGEX} from "@/shared/components/embed/media/MediaEmbed.tsx"
import {hasImageOrVideo} from "@/shared/utils/mediaUtils"
import {useSettingsStore} from "@/stores/settings"
import MarketGridItem from "../market/MarketGridItem"
import {isMarketListing} from "@/shared/utils/marketUtils.ts"
import ProxyImg from "../ProxyImg"
import Icon from "../Icons/Icon"
import {LRUCache} from "typescript-lru-cache"
import {ndk} from "@/utils/ndk"
import {KIND_PICTURE_FIRST} from "@/utils/constants"
import {extractImetaImages} from "@/shared/utils/imetaUtils"

interface ImageGridItemProps {
  event: NDKEvent | {id: string}
  index: number
  setActiveItemIndex: (event: NDKEvent, url: string) => void
  onEventFetched?: (event: NDKEvent) => void
  lastElementRef?: MutableRefObject<HTMLDivElement>
  highlightAsNew?: boolean
}

// Use smaller sizes for mobile performance
const MOBILE_THUMB_SIZE = 120
const DESKTOP_THUMB_SIZE = 245

// Cache blurhash URLs to prevent recreation
const blurhashCache = new LRUCache<string, string>({maxSize: 100})

// Memoized blurhash decoder function
const decodeBlurhash = (blurhash: string): string | null => {
  // Check cache first
  const cached = blurhashCache.get(blurhash)
  if (cached) return cached

  try {
    // Use smaller canvas size for better performance
    const canvasSize = 16
    const pixels = decode(blurhash, canvasSize, canvasSize)
    const canvas = document.createElement("canvas")
    canvas.width = canvasSize
    canvas.height = canvasSize
    const ctx = canvas.getContext("2d")
    if (!ctx) return null

    const imageData = ctx.createImageData(canvasSize, canvasSize)
    imageData.data.set(pixels)
    ctx.putImageData(imageData, 0, 0)
    const dataUrl = canvas.toDataURL("image/jpeg", 0.8) // Use JPEG with compression

    // Cache the result
    blurhashCache.set(blurhash, dataUrl)

    return dataUrl
  } catch (e) {
    console.warn("Failed to decode blurhash:", e)
    return null
  }
}

const ImageGridItem = memo(function ImageGridItem({
  event: initialEvent,
  index,
  setActiveItemIndex,
  onEventFetched,
  lastElementRef,
  highlightAsNew = false,
}: ImageGridItemProps) {
  const navigate = useNavigate()
  const [loadErrors, setLoadErrors] = useState<Record<number, boolean>>({})
  const [proxyFailed, setProxyFailed] = useState<Record<number, boolean>>({})
  const [event, setEvent] = useState<NDKEvent | undefined>(
    "content" in initialEvent ? initialEvent : undefined
  )
  const {content, imgproxy} = useSettingsStore()
  const gridItemRef = useRef<HTMLDivElement>(null)
  const subscriptionRef = useRef<NDKSubscription | null>(null)

  // Handle highlight animation with opacity fade-in
  useEffect(() => {
    if (highlightAsNew && gridItemRef.current) {
      // Start with low opacity
      gridItemRef.current.style.opacity = "0.3"
      gridItemRef.current.style.transition = "opacity 0.8s ease-out"

      // Fade in to full opacity
      setTimeout(() => {
        if (gridItemRef.current) {
          gridItemRef.current.style.opacity = "1"
        }
      }, 50)
    }
  }, [highlightAsNew, initialEvent.id])

  const eventIdHex = useMemo(() => {
    return "content" in initialEvent ? initialEvent.id : initialEvent.id
  }, [initialEvent])

  useEffect(() => {
    // Clean up any existing subscription first
    if (subscriptionRef.current) {
      subscriptionRef.current.stop()
      // Force cleanup by removing from subscription manager (NDK bug workaround)
      if (subscriptionRef.current.ndk?.subManager) {
        subscriptionRef.current.ndk.subManager.subscriptions.delete(
          subscriptionRef.current.internalId
        )
      }
      subscriptionRef.current = null
    }

    if (event) {
      onEventFetched?.(event)
      return
    }

    if (eventIdHex) {
      ndk()
        .fetchEvent(eventIdHex)
        .then((fetchedEvent) => {
          if (fetchedEvent) {
            setEvent(fetchedEvent)
            onEventFetched?.(fetchedEvent)
          }
        })
        .catch((err) => console.error("Error fetching event:", err))
    }

    return () => {
      if (subscriptionRef.current) {
        subscriptionRef.current.stop()
        subscriptionRef.current = null
      }
    }
  }, [event, eventIdHex])

  const imageMatch = event?.content.match(IMAGE_REGEX)?.[0]
  const videoMatch = event?.content.match(VIDEO_REGEX)?.[0]

  const urls = useMemo(() => {
    // For kind 20 events, extract images from imeta tags
    if (event?.kind === KIND_PICTURE_FIRST) {
      const images = extractImetaImages(event)
      return images.map((img) => img.url)
    }

    // For other events, extract from content
    return imageMatch
      ? imageMatch.trim().split(/\s+/)
      : videoMatch?.trim().split(/\s+/) || []
  }, [imageMatch, videoMatch, event?.kind, event?.tags])

  // Use smaller sizes for better mobile performance
  const isMobile = window.innerWidth <= 767
  const width = isMobile ? MOBILE_THUMB_SIZE : DESKTOP_THUMB_SIZE

  const imetaTags = useMemo(() => {
    return urls.map((url) => {
      const tag = event?.tags.find((tag) => tag[0] === "imeta" && tag[1].includes(url))
      return tag
    })
  }, [urls, event?.tags])

  const blurhashes = useMemo(() => {
    return imetaTags.map((tag) => {
      if (!tag) return null
      const blurhashPart = tag.find((part) => part.startsWith("blurhash "))
      return blurhashPart ? blurhashPart.split(" ")[1] : null
    })
  }, [imetaTags])

  // if it's not a gif and imeta indicates it's fairly small, load the original
  // otherwise we might run out of mem and crash on mobile
  const loadOriginalIfProxyFails = useMemo(() => {
    return urls.map((url, i) => {
      // On desktop, always load original if proxy fails
      if (!isMobile) return true

      // On mobile, only load original for small, non-gif images
      const tag = imetaTags[i]
      if (!tag) return false

      // Check if it's not a gif
      const mimeType = tag.find((part) => part.startsWith("m "))?.split(" ")[1]
      const isGif = mimeType === "image/gif" || url.toLowerCase().includes(".gif")
      if (isGif) return false

      // Check if it's fairly small (under 500KB or dimensions under 800x600)
      const sizeStr = tag.find((part) => part.startsWith("size "))?.split(" ")[1]
      const dimStr = tag.find((part) => part.startsWith("dim "))?.split(" ")[1]

      if (sizeStr) {
        const size = parseInt(sizeStr, 10)
        if (size < 500000) return true // Less than 500KB
      }

      if (dimStr) {
        const [width, height] = dimStr.split("x").map((d) => parseInt(d, 10))
        if (width && height && width < 800 && height < 800) return true
      }

      return false
    })
  }, [urls, imetaTags, isMobile])

  const blurhashUrls = useMemo(() => {
    return blurhashes.map((blurhash) => {
      if (!blurhash) return null
      return decodeBlurhash(blurhash)
    })
  }, [blurhashes])

  const isBlurred = useMemo(() => {
    return (
      content.blurNSFW &&
      (!!event?.content.toLowerCase().includes("#nsfw") ||
        event?.tags.some((t) => t[0] === "content-warning"))
    )
  }, [content.blurNSFW, event?.content, event?.tags])

  if (!event) {
    return <div className="aspect-square bg-neutral-300 animate-pulse" />
  }

  // Always show kind 20 (picture-first) and kind 30402 (market listings)
  // For other kinds, check if content has media
  if (
    event.kind !== KIND_PICTURE_FIRST &&
    event.kind !== 30402 &&
    !hasImageOrVideo(event.content)
  ) {
    return null
  }

  if (isMarketListing(event)) {
    const shouldBlur =
      isBlurred &&
      (!!event.content.toLowerCase().includes("#nsfw") ||
        event.tags.some((t) => t[0] === "content-warning"))

    return <MarketGridItem event={event} shouldBlur={shouldBlur} width={width} />
  }

  return urls.map((url, i) => {
    // For kind 20 events, all media are images (not videos)
    // For other events, check if it's a video URL
    const isVideo =
      event?.kind !== KIND_PICTURE_FIRST &&
      !!(videoMatch?.includes(url) || (!imageMatch && videoMatch))
    const hasError = loadErrors[i]

    const shouldBlur =
      isBlurred &&
      (!!event.content.toLowerCase().includes("#nsfw") ||
        event.tags.some((t) => t[0] === "content-warning"))

    return (
      <div
        key={`feed${url}${index}-${i}`}
        className={`aspect-square cursor-pointer relative bg-neutral-300 hover:opacity-80 ${
          shouldBlur ? "blur-xl" : ""
        }`}
        onClick={() => {
          if (window.innerWidth > 767) {
            setActiveItemIndex(event, url)
          } else {
            navigate(`/${nip19.noteEncode(event.id)}`)
          }
        }}
        ref={(el) => {
          if (i === urls.length - 1 && lastElementRef && el) {
            lastElementRef.current = el
          }
          if (i === 0) {
            gridItemRef.current = el
          }
        }}
      >
        {hasError || (isVideo && (!imgproxy.enabled || proxyFailed[i])) ? (
          <div
            className="w-full h-full flex items-center justify-center"
            style={{
              backgroundImage: blurhashUrls[i] ? `url(${blurhashUrls[i]})` : undefined,
              backgroundSize: "cover",
              backgroundPosition: "center",
            }}
          >
            {isVideo && (
              <Icon
                name="play-circle-outline"
                className="text-white text-4xl drop-shadow-md opacity-80"
              />
            )}
          </div>
        ) : (
          <ProxyImg
            square={true}
            width={width}
            src={url}
            alt=""
            className="w-full h-full object-cover"
            style={{
              backgroundImage: blurhashUrls[i] ? `url(${blurhashUrls[i]})` : undefined,
              backgroundSize: "cover",
              backgroundPosition: "center",
              // Hide broken image icon
              fontSize: 0,
              color: "transparent",
            }}
            onError={() => setLoadErrors((prev) => ({...prev, [i]: true}))}
            onProxyFailed={() =>
              isVideo && setProxyFailed((prev) => ({...prev, [i]: true}))
            }
            loadOriginalIfProxyFails={loadOriginalIfProxyFails[i]}
            hideBroken={true}
            isVideo={isVideo}
          />
        )}
        {isVideo && imgproxy.enabled && !hasError && (
          <div className="absolute top-0 right-0 m-2 shadow-md shadow-gray-500">
            <Icon
              name="play-square-outline"
              className="text-white opacity-80 drop-shadow-md"
            />
          </div>
        )}
      </div>
    )
  })
})

export default ImageGridItem
