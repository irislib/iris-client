import {ReactNode, useCallback, useEffect, useRef} from "react"

type Props = {
  onLoadMore: () => void
  children: ReactNode
}

const InfiniteScroll = ({onLoadMore, children}: Props) => {
  const observerRef = useRef<HTMLDivElement | null>(null)

  const handleObserver = useCallback(
    (entries: IntersectionObserverEntry[]) => {
      const target = entries[0]
      console.log(
        "InfiniteScroll observer triggered, isIntersecting:",
        target.isIntersecting
      )
      if (target.isIntersecting) {
        onLoadMore()
      }
    },
    [onLoadMore]
  )

  useEffect(() => {
    // TODO hack to get this working with nested scrollable containers in column layout
    const findScrollRoot = () => {
      if (!observerRef.current) return null

      let element = observerRef.current.parentElement
      while (element) {
        const style = window.getComputedStyle(element)
        if (style.overflowY === "scroll" || style.overflowY === "auto") {
          // Skip the PullToRefresh data-scrollable div to find the actual scroll container
          if (element.hasAttribute("data-scrollable")) {
            element = element.parentElement
            continue
          }
          return element
        }
        element = element.parentElement
      }
      return null
    }

    const scrollRoot = findScrollRoot()

    const observerOptions = {
      root: scrollRoot,
      rootMargin: "1000px",
      threshold: 1.0,
    }

    const observer = new IntersectionObserver(handleObserver, observerOptions)
    if (observerRef.current) {
      observer.observe(observerRef.current)
    }

    return () => {
      if (observerRef.current) {
        observer.unobserve(observerRef.current)
      }
    }
  }, [handleObserver])

  return (
    <>
      {children}
      <div ref={observerRef} />
    </>
  )
}

export default InfiniteScroll
