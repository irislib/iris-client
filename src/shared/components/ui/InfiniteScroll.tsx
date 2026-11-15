import {ReactNode, useEffect, useRef} from "react"

function findNearestScrollingParent(element: HTMLElement): HTMLElement | null {
  let parent = element.parentElement
  while (parent) {
    const computedStyle = getComputedStyle(parent)
    const overflowY = computedStyle.overflowY
    if (
      overflowY === "auto" ||
      overflowY === "scroll" ||
      parent.hasAttribute("data-scrollable")
    ) {
      return parent
    }
    parent = parent.parentElement
  }
  return null
}

type Props = {
  onLoadMore: () => void
  children: ReactNode
  loadMoreKey?: string | number
  loading?: boolean
}

const InfiniteScroll = ({
  onLoadMore,
  children,
  loadMoreKey = 0,
  loading = false,
}: Props) => {
  const observerRef = useRef<HTMLDivElement | null>(null)
  const onLoadMoreRef = useRef(onLoadMore)
  const wasIntersectingRef = useRef(false)
  const attemptedKeyRef = useRef<string | number | null>(null)
  onLoadMoreRef.current = () => {
    if (
      !wasIntersectingRef.current ||
      loading ||
      attemptedKeyRef.current === loadMoreKey
    ) {
      return
    }
    attemptedKeyRef.current = loadMoreKey
    onLoadMore()
  }

  useEffect(() => {
    // A short feed can leave its end marker in view while more relay data
    // arrives. Retry on new candidates or appended posts, once per key, and
    // defer that attempt until an in-flight batch has finished.
    onLoadMoreRef.current()
  }, [loadMoreKey, loading])

  useEffect(() => {
    const target = observerRef.current
    if (!target) return

    const observerOptions = {
      root: findNearestScrollingParent(target),
      rootMargin: "400px 0px",
      threshold: 0,
    }

    const observer = new IntersectionObserver((entries) => {
      const target = entries[0]
      wasIntersectingRef.current = target.isIntersecting
      if (!target.isIntersecting) attemptedKeyRef.current = null
      onLoadMoreRef.current()
    }, observerOptions)
    observer.observe(target)

    return () => {
      observer.disconnect()
      wasIntersectingRef.current = false
      attemptedKeyRef.current = null
    }
  }, [])

  return (
    <>
      {children}
      <div ref={observerRef} className="h-px" aria-hidden="true" />
    </>
  )
}

export default InfiniteScroll
