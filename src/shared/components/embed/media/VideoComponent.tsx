import {calculateDimensions, generateBlurhashUrl} from "./mediaUtils"
import {useLocalState} from "irisdb-hooks/src/useLocalState"
import {useEffect, useRef, useState, useMemo} from "react"
import {generateProxyUrl} from "../../../utils/imgproxy"
import {NDKEvent} from "@nostr-dev-kit/ndk"
import {localState} from "irisdb/src"
import classNames from "classnames"

interface HlsVideoComponentProps {
  match: string
  event: NDKEvent | undefined
  limitHeight?: boolean
  onClick?: () => void
  blur?: boolean
  imeta?: string[]
}

function HlsVideoComponent({
  match,
  event,
  limitHeight,
  onClick,
  imeta,
}: HlsVideoComponentProps) {
  let blurNSFW = true
  localState.get("settings/blurNSFW").on((value) => {
    if (typeof value === "boolean") {
      blurNSFW = value
    }
  })

  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [blur, setBlur] = useState(
    blurNSFW &&
      (!!event?.content.toLowerCase().includes("#nsfw") ||
        event?.tags.some((t) => t[0] === "content-warning"))
  )

  const [autoplayVideos] = useLocalState<boolean>("settings/autoplayVideos", true)

  // Extract dimensions from imeta tag if available
  const dimensions = imeta?.find((tag) => tag.startsWith("dim "))?.split(" ")[1]
  const [originalWidth, originalHeight] = dimensions
    ? dimensions.split("x").map(Number)
    : [null, null]

  // Extract blurhash from imeta tag if available
  const blurhash = imeta?.find((tag) => tag.startsWith("blurhash "))?.split(" ")[1]

  const calculatedDimensions = calculateDimensions(
    originalWidth,
    originalHeight,
    limitHeight
  )

  // Generate blurhash URL
  const blurhashUrl = useMemo(
    () => generateBlurhashUrl(blurhash, calculatedDimensions),
    [blurhash, calculatedDimensions]
  )

  useEffect(() => {
    const initVideo = async () => {
      const isHls = match.includes(".m3u8") || match.includes("playlist")

      if (!isHls || videoRef.current?.canPlayType("application/vnd.apple.mpegurl")) {
        videoRef.current!.src = match
        return
      }

      try {
        const {default: Hls} = await import("hls.js")
        if (Hls.isSupported() && videoRef.current) {
          const hls = new Hls()
          hls.loadSource(match)
          hls.attachMedia(videoRef.current)
        }
      } catch (error) {
        console.error("Failed to load HLS:", error)
      }
    }

    initVideo()

    if (autoplayVideos) {
      const handleIntersection = (entries: IntersectionObserverEntry[]) => {
        const entry = entries[0]
        if (entry.isIntersecting) {
          videoRef.current?.play()
        } else {
          videoRef.current?.pause()
        }
      }

      const observer = new IntersectionObserver(handleIntersection, {
        threshold: 0.33,
      })

      if (videoRef.current) {
        observer.observe(videoRef.current)
      }

      return () => {
        if (videoRef.current) {
          observer.unobserve(videoRef.current)
        }
      }
    }
  }, [match, autoplayVideos])

  return (
    <div
      className={classNames("relative w-full justify-center flex object-contain my-2", {
        "h-[600px]": limitHeight || !dimensions,
      })}
    >
      <video
        onClick={(e) => {
          e.stopPropagation()
          if (blur) {
            setBlur(false)
          }
          onClick?.()
        }}
        ref={videoRef}
        className={classNames("max-w-full object-contain", {
          "blur-xl": blur,
          "h-full max-h-[600px]": limitHeight || !dimensions,
          "max-h-[90vh] lg:h-[600px]": !limitHeight && dimensions,
        })}
        style={{
          ...calculatedDimensions,
          backgroundImage: blurhashUrl ? `url(${blurhashUrl})` : undefined,
          backgroundSize: "cover",
          backgroundPosition: "center",
        }}
        controls
        muted={autoplayVideos}
        autoPlay={autoplayVideos}
        playsInline
        loop
        poster={generateProxyUrl(match, {height: 638})}
      ></video>
    </div>
  )
}

export default HlsVideoComponent
