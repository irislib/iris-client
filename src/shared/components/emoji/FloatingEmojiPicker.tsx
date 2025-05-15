import {LoadingFallback} from "@/shared/components/LoadingFallback"
import {useEffect, useRef, useState, lazy, Suspense} from "react"
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
    if (position?.clientY && isDesktop) {
      setPickerDirection(position.clientY < window.innerHeight / 2 ? "down" : "up")
    }
  }, [position?.clientY])

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
    if (!isDesktop) return "bottom-20 fixed left-4 z-10"

    if (position?.openRight !== undefined) {
      return classNames(
        "md:absolute",
        pickerDirection === "down" ? "md:top-full" : "md:top-0 md:-translate-y-full",
        "z-10",
        position.openRight ? "md:right-0" : "md:left-0"
      )
    }

    return pickerDirection === "down"
      ? "md:absolute md:left-0 md:top-full z-10"
      : "md:absolute md:left-0 md:top-0 md:-translate-y-full z-10"
  }

  return (
    <div
      ref={pickerRef}
      className={classNames(getPositionClasses(), className)}
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
