import {LoadingFallback} from "@/shared/components/LoadingFallback"
import {useEffect, useRef, useState, lazy, Suspense, type CSSProperties} from "react"
import {isTouchDevice} from "@/shared/utils/isTouchDevice"
import EmojiType from "@/types/emoji"
import classNames from "classnames"

const EmojiPicker = lazy(() => import("@emoji-mart/react"))

interface FloatingEmojiPickerProps {
  isOpen: boolean
  onClose: () => void
  onEmojiSelect: (emoji: EmojiType) => void
  position?: {
    clientY?: number
    clientX?: number
    openRight?: boolean
  }
  className?: string
}

export const FloatingEmojiPicker = ({
  isOpen,
  onClose,
  onEmojiSelect,
  position,
  className,
}: FloatingEmojiPickerProps) => {
  const [emojiData, setEmojiData] = useState<Record<string, unknown> | null>(null)
  const [pickerDirection, setPickerDirection] = useState("up")
  const [shouldAlignLeft, setShouldAlignLeft] = useState(false)
  const pickerRef = useRef<HTMLDivElement>(null)
  const isDesktop = typeof window !== "undefined" && window.innerWidth >= 768

  useEffect(() => {
    if (isOpen && !emojiData) {
      import("@emoji-mart/data")
        .then((module) => module.default)
        .then((data) => setEmojiData(data))
    }
  }, [isOpen, emojiData])

  useEffect(() => {
    if (isOpen && isDesktop) {
      // Check vertical direction
      if (position?.clientY) {
        const spaceAbove = position.clientY
        const spaceBelow = window.innerHeight - position.clientY
        // Prefer opening toward the roomier side, require minimum buffer above
        const shouldOpenUp = spaceAbove > 180 && spaceAbove >= spaceBelow
        setPickerDirection(shouldOpenUp ? "up" : "down")
      }

      // Check horizontal direction
      if (position?.clientX) {
        const spaceRight = window.innerWidth - position.clientX
        // Emoji picker needs ~350px width
        setShouldAlignLeft(spaceRight < 350)
      }
    }
  }, [isOpen, isDesktop, position?.clientY, position?.clientX])

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(event.target as Node)) {
        onClose()
      }
    }

    const handleEscKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose()
    }

    document.addEventListener("mousedown", handleClickOutside)
    document.addEventListener("keydown", handleEscKey)
    return () => {
      document.removeEventListener("mousedown", handleClickOutside)
      document.removeEventListener("keydown", handleEscKey)
    }
  }, [onClose])

  if (!isOpen || !emojiData) return null

  const getPositionClasses = () => {
    if (!isDesktop) return "bottom-20 fixed left-4 z-50"

    return "fixed z-50"
  }

  const getPositionStyles = (): CSSProperties => {
    if (!isDesktop || !position?.clientY || !position?.clientX) return {}

    const alignRight = shouldAlignLeft || position?.openRight
    const style: CSSProperties = {}

    // Vertical positioning
    if (pickerDirection === "down") {
      style.top = position.clientY
    } else {
      style.bottom = window.innerHeight - position.clientY
    }

    // Horizontal positioning
    if (alignRight) {
      style.right = window.innerWidth - position.clientX
    } else {
      style.left = position.clientX
    }

    return style
  }

  return (
    <div
      ref={pickerRef}
      className={classNames(getPositionClasses(), "pointer-events-auto", className)}
      style={getPositionStyles()}
      onClick={(e) => e.stopPropagation()}
    >
      <Suspense fallback={<LoadingFallback />}>
        <EmojiPicker
          data={emojiData}
          onEmojiSelect={onEmojiSelect}
          autoFocus={!isTouchDevice}
          searchPosition="sticky"
          previewPosition="none"
          skinTonePosition="none"
          theme="auto"
          maxFrequentRows={1}
        />
      </Suspense>
    </div>
  )
}
