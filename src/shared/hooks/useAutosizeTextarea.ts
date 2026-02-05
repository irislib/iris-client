import {useLayoutEffect, useRef} from "react"

export function useAutosizeTextarea(value: string, {maxRows = 6} = {}) {
  const ref = useRef<HTMLTextAreaElement>(null)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const computed = getComputedStyle(el)
    const lineHeight = parseFloat(computed.lineHeight)
    const fontSize = parseFloat(computed.fontSize)
    const line =
      Number.isFinite(lineHeight) && lineHeight > 0
        ? lineHeight
        : Number.isFinite(fontSize) && fontSize > 0
          ? fontSize * 1.2
          : 16
    const paddingTop = parseFloat(computed.paddingTop) || 0
    const paddingBottom = parseFloat(computed.paddingBottom) || 0
    const maxHeight = line * maxRows + paddingTop + paddingBottom
    el.style.height = "auto" // Reset height to auto (resets after send or removing line)
    el.style.height = Math.min(el.scrollHeight, maxHeight) + "px"
    el.style.textAlign =
      el.scrollHeight <= line + paddingTop + paddingBottom + 1 ? "center" : "left"
  }, [value, maxRows])

  return ref
}
