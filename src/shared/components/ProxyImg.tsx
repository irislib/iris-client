import {CSSProperties, useEffect, useState, MouseEvent, useRef} from "react"
import {generateProxyUrl} from "../utils/imgproxy"
import {imgproxyFailureCache} from "@/utils/memcache"
import {useSettingsStore} from "@/stores/settings"

type Props = {
  src: string
  className?: string
  style?: CSSProperties
  width?: number
  square?: boolean
  onError?: () => void
  onClick?: (ev: MouseEvent) => void
  alt?: string
  hideBroken?: boolean
  loadOriginalIfProxyFails?: boolean
}

const safeOrigins = [
  "data:image",
  "https://imgur.com/",
  "https://i.imgur.com/",
  "https://imgproxy.iris.to/",
  "https://imgproxy.coracle.social/",
]

const shouldSkipProxy = (url: string) => {
  return safeOrigins.some((origin) => url.startsWith(origin))
}

const LOAD_TIMEOUT = 2000 // 2 seconds timeout

const ProxyImg = (props: Props) => {
  const {imgproxy} = useSettingsStore()
  const [proxyFailed, setProxyFailed] = useState(false)
  const [src, setSrc] = useState(props.src)
  const [loadFailed, setLoadFailed] = useState(false)
  const timeoutRef = useRef<NodeJS.Timeout | null>(null)
  const imgRef = useRef<HTMLImageElement | null>(null)

  useEffect(() => {
    let mySrc = props.src

    // Check if this URL has previously failed through imgproxy
    const hasProxyFailed = imgproxyFailureCache.has(props.src)

    const shouldUseProxy =
      imgproxy.enabled &&
      props.src &&
      !props.src.startsWith("data:image") &&
      !hasProxyFailed &&
      (!shouldSkipProxy(props.src) || props.width)

    if (shouldUseProxy) {
      mySrc = generateProxyUrl(
        props.src,
        {width: props.width, square: props.square},
        {
          url: imgproxy.url,
          key: imgproxy.key,
          salt: imgproxy.salt,
        }
      )
      setSrc(mySrc)
    } else {
      // Use original URL if proxy is disabled or should be skipped
      setSrc(props.src)
    }

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }
    }
  }, [props.src, props.width, props.square, imgproxy])

  useEffect(() => {
    // If we've already switched to the original, do NOT set the timer again
    if (proxyFailed || !src || !imgRef.current) return
    // Otherwise, set your load timer
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    timeoutRef.current = setTimeout(() => {
      handleError()
    }, LOAD_TIMEOUT)

    // Check if the image loaded quickly
    const checkLoading = () => {
      if (imgRef.current?.complete || (imgRef.current?.naturalWidth ?? 0) > 0) {
        if (timeoutRef.current) {
          clearTimeout(timeoutRef.current)
          timeoutRef.current = null
        }
      }
    }

    checkLoading()
    const checkInterval = setInterval(checkLoading, 100)
    return () => clearInterval(checkInterval)
  }, [src, proxyFailed])

  const handleError = () => {
    if (proxyFailed) {
      // We already tried the original, so bail out
      setLoadFailed(true)
      props.onError?.()
      if (props.hideBroken) setSrc("")
    } else {
      // The proxy failed or timed out
      imgproxyFailureCache.set(props.src, true)

      const shouldFallback =
        props.loadOriginalIfProxyFails !== undefined
          ? props.loadOriginalIfProxyFails
          : imgproxy.fallbackToOriginal

      if (!shouldFallback) {
        // Do not load from original source, treat as failure
        setLoadFailed(true)
        props.onError?.()
        if (props.hideBroken) setSrc("")
      } else {
        // Switch to the original source
        setProxyFailed(true)
        setSrc(props.src)
      }
    }
  }

  if (!src || loadFailed) {
    return null
  }

  return (
    <img
      ref={imgRef}
      loading="lazy"
      src={src}
      onError={handleError}
      onClick={props.onClick}
      className={props.className}
      style={props.style}
      alt={props.alt}
    />
  )
}

export default ProxyImg
