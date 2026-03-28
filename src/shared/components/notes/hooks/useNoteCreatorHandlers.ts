import {KeyboardEvent, Dispatch, RefObject} from "react"
import {useNavigate} from "@/navigation"
import {nip19} from "nostr-tools"
import {NDKEvent} from "@/lib/ndk"
import {ImetaTag} from "@/stores/draft"
import {SearchResult} from "@/utils/profileSearch"
import {NoteCreatorState, NoteCreatorAction} from "./useNoteCreatorState"

interface UseNoteCreatorHandlersParams {
  state: NoteCreatorState
  dispatch: Dispatch<NoteCreatorAction>
  textareaRef: RefObject<HTMLTextAreaElement | null>
  publish: (state: NoteCreatorState) => Promise<
    | false
    | {
        success: boolean
        event: NDKEvent | null
        eventId: string | null
      }
  >
  mentionSearch: string | null
  searchResults: SearchResult[]
  selectedMentionIndex: number
  handleSelectMention: (
    result: SearchResult,
    onTextChange: (text: string) => void
  ) => void
  moveMentionSelection: (direction: "up" | "down") => void
  clearMention: () => void
  detectMention: (position: number) => void
  expandOnFocus: boolean
  isFocused: boolean
  setIsFocused: (focused: boolean) => void
  replyingTo?: NDKEvent
  onClose?: () => void
  onPublishCallback?: (event: NDKEvent) => void
}

export function useNoteCreatorHandlers(params: UseNoteCreatorHandlersParams) {
  const navigate = useNavigate()

  const handleTextChange = (value: string) => {
    params.dispatch({type: "SET_TEXT", payload: value})
    if (params.textareaRef.current) {
      params.detectMention(params.textareaRef.current.selectionStart)
    }
  }

  const handleSubmit = async () => {
    const result = await params.publish(params.state)
    if (result && result.success) {
      // No delay needed - cache operations are properly awaited in publish()
      // Navigate before closing modal (if not a reply)
      if (result.eventId && !params.replyingTo) {
        navigate(`/${nip19.noteEncode(result.eventId)}`)
      }
      // Close modal and call callback after navigation
      params.onClose?.()
      if (result.event) {
        params.onPublishCallback?.(result.event)
      }
    }
  }

  const handleUpload = (
    url: string,
    metadata?: {width: number; height: number; blurhash: string}
  ) => {
    params.dispatch({
      type: "SET_TEXT",
      payload: params.state.text + (params.state.text ? "\n" : "") + url,
    })
    if (metadata) {
      const newImeta: ImetaTag = {
        url,
        width: metadata.width,
        height: metadata.height,
        blurhash: metadata.blurhash,
      }
      params.dispatch({type: "ADD_IMETA", payload: newImeta})
    }
  }

  const handleEmojiSelect = (emoji: {native: string}) => {
    const cursorPos =
      params.textareaRef.current?.selectionStart || params.state.text.length
    const newText =
      params.state.text.slice(0, cursorPos) +
      emoji.native +
      params.state.text.slice(cursorPos)
    params.dispatch({type: "SET_TEXT", payload: newText})

    setTimeout(() => {
      if (params.textareaRef.current) {
        const newCursorPos = cursorPos + emoji.native.length
        params.textareaRef.current.selectionStart = newCursorPos
        params.textareaRef.current.selectionEnd = newCursorPos
        params.textareaRef.current.focus()
      }
    }, 0)
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (params.searchResults.length > 0 && params.mentionSearch !== null) {
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault()
          params.moveMentionSelection("down")
          return
        case "ArrowUp":
          e.preventDefault()
          params.moveMentionSelection("up")
          return
        case "Tab":
        case "Enter":
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            break
          }
          e.preventDefault()
          if (
            params.selectedMentionIndex >= 0 &&
            params.searchResults[params.selectedMentionIndex]
          ) {
            params.handleSelectMention(
              params.searchResults[params.selectedMentionIndex],
              handleTextChange
            )
          }
          return
        case "Escape":
          e.preventDefault()
          params.clearMention()
          return
      }
    }

    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault()
      handleSubmit()
    } else if (e.key === "Escape") {
      e.preventDefault()
      if (!params.state.text.trim() && params.expandOnFocus) {
        params.setIsFocused(false)
        params.textareaRef.current?.blur()
      }
    }
  }

  return {
    handleTextChange,
    handleSubmit,
    handleUpload,
    handleEmojiSelect,
    handleKeyDown,
  }
}
