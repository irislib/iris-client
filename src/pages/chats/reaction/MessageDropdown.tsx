import {MouseEvent, useState} from "react"
import {RiMoreLine} from "@remixicon/react"
import Dropdown from "@/shared/components/ui/Dropdown"
import {useMessageDeletion} from "../hooks/useMessageDeletion"

type MessageDropdownProps = {
  messageId: string
  sessionId: string
  isUser: boolean
  onInfoClick: () => void
}

export const MessageDropdown = ({
  messageId,
  sessionId,
  isUser,
  onInfoClick,
}: MessageDropdownProps) => {
  const [showDropdown, setShowDropdown] = useState(false)
  const [dropdownPosition, setDropdownPosition] = useState<{clientY?: number}>({})
  const {deleteMessageLocally} = useMessageDeletion()

  const handleMoreClick = (e: MouseEvent) => {
    const buttonRect = e.currentTarget.getBoundingClientRect()
    setDropdownPosition({clientY: buttonRect.top})
    setShowDropdown(!showDropdown)
  }

  const handleInfoClick = () => {
    setShowDropdown(false)
    onInfoClick()
  }

  const handleDeleteLocally = async () => {
    const deleted = await deleteMessageLocally(messageId, sessionId)
    if (deleted) {
      // Close the dropdown if deletion was confirmed
      setShowDropdown(false)
    }
  }

  return (
    <>
      <div
        data-testid="more-button"
        role="button"
        aria-label="More options"
        className="p-1 md:p-2 text-base-content/50 rounded-full opacity-0 group-hover:opacity-100 cursor-pointer transition-opacity flex-shrink-0"
        onClick={handleMoreClick}
      >
        <RiMoreLine className="w-5 h-5 md:w-6 md:h-6" />
      </div>

      {showDropdown && (
        <div className="absolute z-50">
          <Dropdown
            onClose={() => setShowDropdown(false)}
            position={{
              clientY: dropdownPosition.clientY,
              alignRight: isUser,
            }}
          >
            <ul className="dropdown-content menu p-2 shadow bg-base-100 rounded-box w-40">
              <li>
                <button onClick={handleInfoClick}>Info</button>
              </li>
              <li>
                <button onClick={handleDeleteLocally} className="text-error">
                  Delete locally
                </button>
              </li>
            </ul>
          </Dropdown>
        </div>
      )}
    </>
  )
}
