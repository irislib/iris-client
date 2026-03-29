import {RefObject, useEffect} from "react"
import {useIsTopOfStack} from "@/navigation/useIsTopOfStack"

export function usePauseMediaWhenHidden(mediaRef: RefObject<HTMLMediaElement | null>) {
  const isTopOfStack = useIsTopOfStack()

  useEffect(() => {
    const pauseIfHidden = () => {
      const media = mediaRef.current
      if (!media) return

      if (!isTopOfStack || document.visibilityState !== "visible") {
        media.pause()
      }
    }

    pauseIfHidden()
    document.addEventListener("visibilitychange", pauseIfHidden)

    return () => {
      document.removeEventListener("visibilitychange", pauseIfHidden)
      mediaRef.current?.pause()
    }
  }, [isTopOfStack, mediaRef])
}
