import {useLayoutEffect, useRef} from "react"

export function useAutosizeTextarea(value: string, {maxRows = 6} = {}) {
  const ref = useRef<HTMLTextAreaElement>(null)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const line = parseFloat(getComputedStyle(el).lineHeight)
    el.style.height = "auto" // Reset height to auto (resets after send or removing line)
    el.style.height = Math.min(el.scrollHeight, line * maxRows) + "px"
    el.style.textAlign = el.scrollHeight <= line + 1 ? "center" : "left"
  }, [value, maxRows])

  return ref
}
