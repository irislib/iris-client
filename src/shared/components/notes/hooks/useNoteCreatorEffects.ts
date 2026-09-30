import {useEffect, RefObject} from "react"
import {AppEvent} from "@/lib/nostr"

interface UseNoteCreatorEffectsParams {
  autofocus: boolean
  quotedEvent?: AppEvent
  textareaRef: RefObject<HTMLTextAreaElement | null>
  expandOnFocus: boolean
  text: string
  containerRef: RefObject<HTMLDivElement | null>
  setIsFocused: (focused: boolean) => void
}

export function useNoteCreatorEffects(params: UseNoteCreatorEffectsParams) {
  // Handle autofocus
  useEffect(() => {
    if (params.autofocus && params.textareaRef.current) {
      params.textareaRef.current.focus()
      if (params.quotedEvent) {
        setTimeout(() => {
          params.textareaRef.current?.setSelectionRange(0, 0)
        }, 0)
      }
    }
  }, [params.autofocus, params.quotedEvent, params.textareaRef])

  // Handle click outside
  useEffect(() => {
    if (!params.expandOnFocus) return

    const handleClickOutside = (event: MouseEvent) => {
      if (
        params.containerRef.current &&
        !params.containerRef.current.contains(event.target as Node)
      ) {
        if (!params.text.trim()) {
          params.setIsFocused(false)
        }
      }
    }

    document.addEventListener("mousedown", handleClickOutside)
    return () => {
      document.removeEventListener("mousedown", handleClickOutside)
    }
  }, [params.text, params.expandOnFocus, params.containerRef, params.setIsFocused])
}
