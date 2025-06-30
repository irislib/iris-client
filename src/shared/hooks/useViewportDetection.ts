import {useCallback, useEffect, useState, type RefObject} from "react"

interface UseViewportDetectionProps {
  targetRef: RefObject<HTMLElement | null>
}

export const useViewportDetection = ({targetRef}: UseViewportDetectionProps) => {
  const [isAboveViewport, setIsAboveViewport] = useState(false)

  const handleObserver = useCallback((entries: IntersectionObserverEntry[]) => {
    const target = entries[0]
    setIsAboveViewport(!target.isIntersecting)
  }, [])

  useEffect(() => {
    const observerOptions = {
      rootMargin: "0px",
      threshold: 0,
    }

    const observer = new IntersectionObserver(handleObserver, observerOptions)
    if (targetRef.current) {
      observer.observe(targetRef.current)
    }

    return () => {
      if (targetRef.current) {
        observer.unobserve(targetRef.current)
      }
    }
  }, [handleObserver, targetRef])

  return isAboveViewport
}
