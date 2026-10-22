import {RefObject, KeyboardEvent} from "react"
import HyperText from "@/shared/components/HyperText"

interface NoteTextareaProps {
  textareaRef: RefObject<HTMLTextAreaElement | null>
  text: string
  onTextChange: (text: string) => void
  onFocus: () => void
  onSelect: () => void
  onBlur: () => void
  onKeyDown: (e: KeyboardEvent<HTMLTextAreaElement>) => void
  placeholder: string
  previewMode: boolean
  isModal: boolean
  shouldExpand: boolean
}

export function NoteTextarea({
  textareaRef,
  text,
  onTextChange,
  onFocus,
  onKeyDown,
  onSelect,
  onBlur,
  placeholder,
  previewMode,
  isModal,
  shouldExpand,
}: NoteTextareaProps) {
  const containerHeight = (() => {
    if (isModal) return "100%"
    if (shouldExpand) return "80px"
    return "32px"
  })()

  return (
    <div className={isModal ? "h-[300px] overflow-y-auto" : ""}>
      {!previewMode ? (
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => onTextChange(e.target.value)}
          onFocus={onFocus}
          onKeyDown={onKeyDown}
          onSelect={onSelect}
          onBlur={onBlur}
          placeholder={placeholder}
          className={`w-full bg-transparent resize-none outline-none placeholder-base-content/50 ${
            isModal
              ? "textarea border-0 focus:outline-none p-0 text-lg h-full"
              : "text-base"
          }`}
          style={{
            minHeight: containerHeight,
            height: (() => {
              if (isModal) return "100%"
              if (shouldExpand) return "auto"
              return "32px"
            })(),
            overflow: shouldExpand && !isModal ? "visible" : "hidden",
          }}
        />
      ) : (
        <div
          className={isModal ? "text-lg" : "text-base"}
          style={{
            minHeight: containerHeight,
          }}
        >
          <HyperText textPadding={false}>{text}</HyperText>
        </div>
      )}
    </div>
  )
}
