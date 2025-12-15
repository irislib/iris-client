import {calculateDimensions, generateBlurhashUrl} from "./mediaUtils"
import {useEffect, useRef, useState, useMemo, memo, useCallback} from "react"
import {generateVideoProxyUrl} from "../../../utils/imgproxy"
import {useSettingsStore} from "@/stores/settings"
import classNames from "classnames"
import {EmbedEvent} from "../index"
import {parseImetaTag} from "@/shared/utils/imetaUtils"

interface HlsVideoComponentProps {
  match: string
  event: EmbedEvent | undefined
  limitHeight?: boolean
  onClick?: () => void
  blur?: boolean
  imeta?: string[]
  isMuted?: boolean
  onMuteChange?: (muted: boolean) => void
}

function HlsVideoComponent({
  match,
  event,
  limitHeight,
  onClick,
  imeta,
  isMuted = true,
  onMuteChange,
}: HlsVideoComponentProps) {
  const {content, imgproxy} = useSettingsStore()
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [hasVideoTrack, setHasVideoTrack] = useState(true)
  const [blur, setBlur] = useState(
    content.blurNSFW &&
      (!!event?.content.toLowerCase().includes("#nsfw") ||
        event?.tags.some((t) => t[0] === "content-warning"))
  )

  // Parse imeta data
  const imetaData = useMemo(() => {
    if (!imeta) return undefined
    return parseImetaTag(imeta)
  }, [imeta])

  const originalWidth = imetaData?.width || null
  const originalHeight = imetaData?.height || null
  const blurhash = imetaData?.blurhash

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

  // Memoize video initialization to prevent unnecessary re-runs
  const initVideo = useCallback(async () => {
    if (!videoRef.current) return

    const isHls = match.includes(".m3u8") || match.includes("playlist")

    if (!isHls || videoRef.current.canPlayType("application/vnd.apple.mpegurl")) {
      videoRef.current.src = match
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
  }, [match])

  // Initialize video when match changes
  useEffect(() => {
    initVideo()
  }, [initVideo])

  // Check if video has a video track (not audio-only)
  useEffect(() => {
    if (!videoRef.current) return

    const checkVideoTrack = () => {
      if (videoRef.current && videoRef.current.readyState >= 1) {
        // Check if video has dimensions (audio-only files have 0x0)
        const hasVideo =
          videoRef.current.videoWidth > 0 && videoRef.current.videoHeight > 0
        setHasVideoTrack(hasVideo)
      }
    }

    videoRef.current.addEventListener("loadedmetadata", checkVideoTrack)

    return () => {
      videoRef.current?.removeEventListener("loadedmetadata", checkVideoTrack)
    }
  }, [match])

  // Handle autoplay with intersection observer
  useEffect(() => {
    if (!content.autoplayVideos || !videoRef.current || !hasVideoTrack) return

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

    const currentVideo = videoRef.current
    observer.observe(currentVideo)

    return () => {
      observer.unobserve(currentVideo)
    }
  }, [content.autoplayVideos, hasVideoTrack])

  // Define default dimensions to prevent layout shift
  const defaultWidth = Math.min(650, window.innerWidth)
  const defaultHeight = limitHeight ? 400 : 500 // 16:10 aspect ratio approximation

  const containerStyle = {
    // Always provide height to prevent layout shift
    height: calculatedDimensions?.height || `${defaultHeight}px`,
  }

  const videoStyle = {
    ...calculatedDimensions,
    // Always provide dimensions to prevent layout shift
    width: calculatedDimensions?.width || `${defaultWidth}px`,
    height: calculatedDimensions?.height || `${defaultHeight}px`,
    backgroundImage: blurhashUrl ? `url(${blurhashUrl})` : undefined,
    backgroundSize: "cover",
    backgroundPosition: "center",
  }

  return (
    <div
      className={classNames("relative w-full justify-center flex object-contain my-2")}
      style={containerStyle}
    >
      <video
        onClick={(e) => {
          e.stopPropagation()
          if (blur) {
            setBlur(false)
          }
          onClick?.()
        }}
        onVolumeChange={(e) => {
          const video = e.target as HTMLVideoElement
          onMuteChange?.(video.muted)
        }}
        ref={videoRef}
        className={classNames("max-w-full object-contain", {
          "blur-xl": blur,
          "h-full max-h-[600px]": true,
        })}
        style={videoStyle}
        controls
        muted={hasVideoTrack ? isMuted : false}
        autoPlay={content.autoplayVideos && hasVideoTrack}
        playsInline
        loop
        poster={generateVideoProxyUrl(match, {
          url: imgproxy.vidproxyUrl,
          key: imgproxy.key,
          salt: imgproxy.salt,
        })}
      ></video>
    </div>
  )
}

export default memo(HlsVideoComponent)
