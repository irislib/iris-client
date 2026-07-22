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
}

const InfiniteScroll = ({onLoadMore, children, scrollContainer}: Props) => {
  const observerRef = useRef<HTMLDivElement | null>(null)
  const onLoadMoreRef = useRef(onLoadMore)
  const wasIntersectingRef = useRef(false)
  onLoadMoreRef.current = onLoadMore

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
      if (target.isIntersecting && !wasIntersectingRef.current) {
        onLoadMoreRef.current()
      }
      wasIntersectingRef.current = target.isIntersecting
    }, observerOptions)
    const target = observerRef.current
    if (target) {
      observer.observe(target)
    }

    return () => {
      observer.disconnect()
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
