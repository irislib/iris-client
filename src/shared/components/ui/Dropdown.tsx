import {ReactNode, useEffect} from "react"
import classNames from "classnames"

type DropdownProps = {
  children: ReactNode
  onClose: () => void
  position?: {
    clientY?: number
    clientX?: number
    alignRight?: boolean
  }
}

function Dropdown({children, onClose, position}: DropdownProps) {
  // Calculate direction based on available space (iris-chat approach)
  const getDirection = () => {
    if (position?.clientY && typeof window !== "undefined") {
      const spaceAbove = position.clientY
      const spaceBelow = window.innerHeight - position.clientY
      // Prefer opening toward the roomier side, require minimum buffer above
      const shouldOpenUp = spaceAbove > 180 && spaceAbove >= spaceBelow
      return shouldOpenUp ? "up" : "down"
    }
    return "down"
  }

  // Check if dropdown should align left to prevent overflow
  const shouldAlignLeft = () => {
    if (position?.clientX && typeof window !== "undefined") {
      const spaceRight = window.innerWidth - position.clientX
      // Need ~140px for dropdown menu
      return spaceRight < 140
    }
    return false
  }

  const direction = getDirection()
  const alignLeft = shouldAlignLeft()

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

  const getPositionClasses = () => {
    const baseClasses = "dropdown dropdown-open dropdown-container z-50"
    // Use alignLeft if space is tight on the right, otherwise respect alignRight prop
    const alignClass =
      alignLeft || (position?.alignRight && !alignLeft) ? "dropdown-end" : "dropdown-left"
    const directionClass = direction === "up" ? "dropdown-top" : "dropdown-bottom"

    return classNames(baseClasses, alignClass, directionClass)
  }

  return <div className={getPositionClasses()}>{children}</div>
}

export default Dropdown
