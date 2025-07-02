import {ReactNode, useEffect} from "react"

type DropdownProps = {
  children: ReactNode
  onClose: () => void
}

function Dropdown({children, onClose}: DropdownProps) {
  useEffect(() => {
    const onEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose()
      }
    }

    const onClickOutside = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest(".dropdown-container")) {
        e.stopPropagation()
        e.preventDefault()
        onClose()
      }
    }

    window.addEventListener("keydown", onEscape)
    window.addEventListener("click", onClickOutside, {capture: true})

    return () => {
      window.removeEventListener("keydown", onEscape)
      window.removeEventListener("click", onClickOutside, {capture: true})
    }
  }, [onClose])

  return (
    <div className="relative dropdown-container">
      {children}
    </div>
  )
}

export default Dropdown
