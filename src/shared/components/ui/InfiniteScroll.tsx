import {ReactNode, useEffect, useRef} from "react"
import {infiniteScrollObserver} from "@/utils/sharedIntersectionObserver"

type Props = {
  onLoadMore: () => void
  children: ReactNode
}

const InfiniteScroll = ({onLoadMore, children}: Props) => {
  const observerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!observerRef.current) return

    const unobserve = infiniteScrollObserver.observe(observerRef.current, (entry) => {
      if (entry.isIntersecting) {
        onLoadMore()
      }
    })

    return unobserve
  }, [onLoadMore])

  return (
    <>
      {children}
      <div ref={observerRef} />
    </>
  )
}

export default InfiniteScroll
