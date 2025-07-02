import {ReactNode, useEffect, useRef, useState} from "react"
import Icon from "../Icons/Icon"

type ModalProps = {
  onClose: () => void
  children: ReactNode
  hasBackground?: boolean
}

const Modal = ({onClose, children, hasBackground = true}: ModalProps) => {
  const modalRef = useRef<HTMLDialogElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const [isMouseDownOnBackdrop, setIsMouseDownOnBackdrop] = useState(false)

  const showModal = () => {
    modalRef.current?.showModal()
  }

  const closeModal = () => {
    modalRef.current?.close()
    onClose?.()
  }

  useEffect(() => {
    showModal()

    const handleEscapeKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        // prevent daisyUI default
        e.preventDefault()
        // Only close if no emoji picker is open
        if (!document.querySelector('[data-emoji-picker="true"]')) {
          onClose()
          closeModal()
        }
      }
    }

    document.addEventListener("keydown", handleEscapeKey)

    const handleMouseDown = (e: MouseEvent) => {
      if (modalRef.current && e.target === modalRef.current) {
        setIsMouseDownOnBackdrop(true)
        e.preventDefault()
      } else {
        setIsMouseDownOnBackdrop(false)
      }
    }

    const handleMouseUp = (e: MouseEvent) => {
      if (isMouseDownOnBackdrop && modalRef.current && e.target === modalRef.current) {
        e.preventDefault()
        e.stopPropagation()
        onClose()
        closeModal()
      }
      setIsMouseDownOnBackdrop(false)
    }

    document.addEventListener("mousedown", handleMouseDown)
    document.addEventListener("mouseup", handleMouseUp)

    return () => {
      closeModal()
      document.removeEventListener("keydown", handleEscapeKey)
      document.removeEventListener("mousedown", handleMouseDown)
      document.removeEventListener("mouseup", handleMouseUp)
    }
  }, [isMouseDownOnBackdrop])

  return (
    <dialog ref={modalRef} className="fixed inset-0 z-50 overflow-y-auto outline-none flex items-center justify-center">
      <div
        ref={contentRef}
        className={hasBackground ? "relative bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-full w-full max-h-full m-4" : ""}
        onClick={(e) => e.stopPropagation()}
      >
        {hasBackground && (
          <button
            className="absolute z-50 right-2 top-2 p-2 rounded-full bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 focus:outline-none"
            onClick={() => {
              onClose()
              closeModal()
            }}
          >
            <Icon name="close" size={12} />
          </button>
        )}
        {children}
      </div>
      {hasBackground && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 -z-10"
          onClick={() => {
            onClose()
            closeModal()
          }}
        />
      )}
    </dialog>
  )
}

export default Modal
