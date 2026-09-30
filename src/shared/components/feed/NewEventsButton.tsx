import {AvatarGroup} from "@/shared/components/user/AvatarGroup.tsx"
import {AppEvent} from "@/lib/nostr"
import {RefObject, useEffect, useState} from "react"
import {createPortal} from "react-dom"

interface NewEventsButtonProps {
  newEventsFiltered: AppEvent[]
  newEventsFrom: Set<string>
  showNewEvents: () => void
  firstFeedItemRef: RefObject<HTMLDivElement | null>
}

const NewEventsButton = ({
  newEventsFiltered,
  newEventsFrom,
  showNewEvents,
  firstFeedItemRef,
}: NewEventsButtonProps) => {
  const [scrollContainer, setScrollContainer] = useState<Element | null>(null)
  const [feedBounds, setFeedBounds] = useState<{left: number; width: number} | null>(null)
  const [isVisible, setIsVisible] = useState(true)

  useEffect(() => {
    // Find the scrollable parent container and get feed bounds
    const findScrollContainer = () => {
      const containers = document.querySelectorAll(".overflow-y-auto, .overflow-y-scroll")
      for (let i = 0; i < containers.length; i++) {
        const container = containers[i]
        if (container.scrollHeight > container.clientHeight) {
          return container
        }
      }
      return null
    }

    const updateBounds = () => {
      const container = findScrollContainer()
      setScrollContainer(container)

      // Get the feed column bounds from the first feed item for more accurate positioning
      if (firstFeedItemRef.current) {
        const feedItemRect = firstFeedItemRef.current.getBoundingClientRect()
        // Use the feed item's horizontal position and width
        setFeedBounds({
          left: feedItemRect.left,
          width: feedItemRect.width,
        })
      } else if (container) {
        // Fallback to container bounds if no feed item
        const rect = container.getBoundingClientRect()
        setFeedBounds({
          left: rect.left,
          width: rect.width,
        })
      }
    }

    updateBounds()
    window.addEventListener("resize", updateBounds)

    return () => window.removeEventListener("resize", updateBounds)
  }, [firstFeedItemRef])

  useEffect(() => {
    // TODO: This is an unfortunate workaround we have to do until we come up with
    // better positioning that doesn't use Portal. The Portal renders to document.body
    // which persists across route changes in our stack router system.
    // Check if the feed is actually visible (not hidden by stack router)
    const checkVisibility = () => {
      if (!firstFeedItemRef.current) {
        setIsVisible(false)
        return
      }

      // Simple check: if the feed item is not in the viewport or has no dimensions, it's likely hidden
      const rect = firstFeedItemRef.current.getBoundingClientRect()
      if (
        rect.width === 0 ||
        rect.height === 0 ||
        rect.top < -1000 ||
        rect.left < -1000
      ) {
        setIsVisible(false)
        return
      }

      // Check if the element or any parent is hidden
      let element = firstFeedItemRef.current as HTMLElement
      let visible = true

      while (element && element !== document.body) {
        const style = window.getComputedStyle(element)
        if (
          style.display === "none" ||
          style.visibility === "hidden" ||
          style.opacity === "0"
        ) {
          visible = false
          break
        }
        // Also check for transform: translateX that might indicate a hidden stack view
        const transform = style.transform
        if (transform && transform !== "none") {
          const elementRect = element.getBoundingClientRect()
          if (elementRect.left > window.innerWidth || elementRect.right < 0) {
            visible = false
            break
          }
        }

        element = element.parentElement!
      }

      setIsVisible(visible)
    }

    checkVisibility()

    // Listen for route changes or visibility changes
    const observer = new MutationObserver(checkVisibility)
    if (firstFeedItemRef.current) {
      let element = firstFeedItemRef.current as HTMLElement
      while (element && element !== document.body) {
        observer.observe(element, {
          attributes: true,
          attributeFilter: ["style", "class"],
        })
        element = element.parentElement!
      }
    }

    // Also check on various events that might change visibility
    window.addEventListener("popstate", checkVisibility)
    window.addEventListener("hashchange", checkVisibility)
    document.addEventListener("visibilitychange", checkVisibility)

    // Check periodically as a fallback
    const interval = setInterval(checkVisibility, 500)

    return () => {
      observer.disconnect()
      window.removeEventListener("popstate", checkVisibility)
      window.removeEventListener("hashchange", checkVisibility)
      document.removeEventListener("visibilitychange", checkVisibility)
      clearInterval(interval)
    }
  }, [firstFeedItemRef, newEventsFiltered.length])

  if (newEventsFiltered.length === 0 || !scrollContainer || !feedBounds || !isVisible)
    return null

  const button = (
    <div
      className="fixed bottom-20 md:bottom-10 z-30 pb-[env(safe-area-inset-bottom)]"
      style={{
        left: `${feedBounds.left + feedBounds.width / 2}px`,
        transform: "translateX(-50%)",
      }}
    >
      <button
        className="btn btn-info shadow-xl rounded-full flex items-center gap-2 px-4 min-w-max"
        onClick={() => {
          showNewEvents()
          scrollContainer.scrollTo({top: 0, behavior: "instant"})
        }}
      >
        <AvatarGroup pubKeys={Array.from(newEventsFrom).slice(0, 3)} />
        Show {newEventsFiltered.length > 99 ? "99+" : newEventsFiltered.length} new events
      </button>
    </div>
  )

  return createPortal(button, document.body)
}

export default NewEventsButton
