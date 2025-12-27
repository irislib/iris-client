import {CSSProperties, useEffect, useState, MouseEvent, useRef} from "react"
import {generateProxyUrl, generateVideoProxyUrl} from "../utils/imgproxy"
import {imgproxyFailureCache, loadedImageCache} from "@/utils/memcache"
import {useSettingsStore} from "@/stores/settings"

type Props = {
  src: string
  className?: string
  style?: CSSProperties
  width?: number
  square?: boolean
  onError?: () => void
  onProxyFailed?: () => void
  onClick?: (ev: MouseEvent) => void
  alt?: string
  hideBroken?: boolean
  loadOriginalIfProxyFails?: boolean
  isVideo?: boolean
}

const safeOrigins = ["data:image"]

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
    // Check if we have this image cached
    const cacheKey = `${props.src}_${props.width}_${props.square}`
    const cachedSrc = loadedImageCache.get(cacheKey)
    if (cachedSrc) {
      setSrc(cachedSrc)
      return
    }

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
      if (props.isVideo) {
        mySrc = generateVideoProxyUrl(mySrc, {
          url: imgproxy.vidproxyUrl,
          key: imgproxy.key,
          salt: imgproxy.salt,
        })
      } else {
        mySrc = generateProxyUrl(
          mySrc,
          {width: props.width, square: props.square},
          {
            url: imgproxy.url,
            key: imgproxy.key,
            salt: imgproxy.salt,
          }
        )
      }
    }

    setSrc(mySrc)
    // Cache the resolved src
    loadedImageCache.set(cacheKey, mySrc)

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }
    }
  }, [props.src, props.width, props.square, imgproxy])

  useEffect(() => {
    // If we've already switched to the original, do NOT set the timer again
    if (proxyFailed || !src || !imgRef.current) return

    const img = imgRef.current

    // Clear existing timeout
    if (timeoutRef.current) clearTimeout(timeoutRef.current)

    // Check if already loaded (cached)
    if (img.complete && img.naturalWidth > 0) {
      return
    }

    // Set load timeout
    timeoutRef.current = setTimeout(() => {
      handleError()
    }, LOAD_TIMEOUT)

    // Use onload event instead of polling
    const handleLoad = () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
        timeoutRef.current = null
      }
    }

    img.addEventListener("load", handleLoad)
    return () => {
      img.removeEventListener("load", handleLoad)
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }
    }
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
      props.onProxyFailed?.()

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
