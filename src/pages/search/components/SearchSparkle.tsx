import {useEffect, useRef} from "react"
import {RiSparklingFill} from "@remixicon/react"
import {useNavigate} from "@/navigation"

interface SearchSparkleProps {
  aiSearch: boolean
  ranking: boolean
  onToggle: () => void
}

export default function SearchSparkle({aiSearch, ranking, onToggle}: SearchSparkleProps) {
  const navigate = useNavigate()
  const press = useRef<{x: number; y: number; timer: number} | null>(null)
  const suppressClick = useRef(false)

  function cancelPress() {
    if (press.current) window.clearTimeout(press.current.timer)
    press.current = null
  }
  useEffect(() => cancelPress, [])

  function openSettings() {
    cancelPress()
    if (suppressClick.current) return
    suppressClick.current = true
    navigate("/settings/content/search-model")
  }

  return (
    <button
      type="button"
      className={`btn btn-square select-none [-webkit-touch-callout:none] ${aiSearch ? "btn-primary" : "btn-ghost"}`}
      aria-label="AI search"
      aria-pressed={aiSearch}
      aria-busy={ranking}
      aria-keyshortcuts="Shift+F10"
      title={`Turn ${aiSearch ? "off" : "on"} AI search · Hold for model settings`}
      onPointerDown={(event) => {
        cancelPress()
        suppressClick.current = false
        if (!event.isPrimary || event.button !== 0) return
        press.current = {
          x: event.clientX,
          y: event.clientY,
          timer: window.setTimeout(openSettings, 500),
        }
      }}
      onPointerMove={({clientX, clientY}) => {
        const start = press.current
        if (start && Math.hypot(clientX - start.x, clientY - start.y) > 10) cancelPress()
      }}
      onPointerLeave={cancelPress}
      onPointerUp={cancelPress}
      onPointerCancel={cancelPress}
      onTouchStart={(event) => {
        // Navigation unmounts this button before touchend. Cancel the synthesized
        // tap at its original target so it cannot activate a setting underneath.
        const gesture = new AbortController()
        event.target.addEventListener(
          "touchend",
          (end) => {
            if (suppressClick.current) end.preventDefault()
            gesture.abort()
          },
          {signal: gesture.signal, passive: false}
        )
        event.target.addEventListener("touchcancel", () => gesture.abort(), {
          signal: gesture.signal,
        })
      }}
      onBlur={cancelPress}
      onContextMenu={(event) => {
        event.preventDefault()
        openSettings()
      }}
      onKeyDown={(event) => {
        if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
          event.preventDefault()
          suppressClick.current = false
          openSettings()
        }
      }}
      onClick={(event) => {
        if (!suppressClick.current || event.detail === 0) onToggle()
        suppressClick.current = false
      }}
    >
      <RiSparklingFill
        size={20}
        className={ranking ? "motion-safe:animate-pulse" : undefined}
      />
    </button>
  )
}
