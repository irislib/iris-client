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
  scrollContainer?: HTMLElement | null
  loadMoreKey?: string | number
  loading?: boolean
}

const InfiniteScroll = ({
  onLoadMore,
  children,
  scrollContainer,
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
    // Find scroll container automatically if not provided
    let actualScrollContainer = scrollContainer
    if (!actualScrollContainer && observerRef.current) {
      actualScrollContainer = findNearestScrollingParent(observerRef.current)
    }

    const observerOptions = {
      root: actualScrollContainer,
      rootMargin: "400px 0px",
      threshold: 0,
    }

    const observer = new IntersectionObserver((entries) => {
      const target = entries[0]
      wasIntersectingRef.current = target.isIntersecting
      if (!target.isIntersecting) attemptedKeyRef.current = null
      onLoadMoreRef.current()
    }, observerOptions)
    const target = observerRef.current
    if (target) {
      observer.observe(target)
    }

    return () => {
      observer.disconnect()
      wasIntersectingRef.current = false
      attemptedKeyRef.current = null
    }
  }, [scrollContainer])

  return (
    <>
      {children}
      <div ref={observerRef} className="h-px" aria-hidden="true" />
    </>
  )
}

export default InfiniteScroll
