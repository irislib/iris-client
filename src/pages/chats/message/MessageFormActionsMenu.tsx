import {RiAddLine, RiAttachment2} from "@remixicon/react"

interface MessageFormActionsMenuProps {
  isOpen: boolean
  onClose: () => void
  onToggle: () => void
  onAttachmentClick: () => void
  onCashuSend: () => void
  attachmentDisabled?: boolean
}

export default function MessageFormActionsMenu({
  isOpen,
  onClose,
  onToggle,
  onAttachmentClick,
  onCashuSend,
  attachmentDisabled = false,
}: MessageFormActionsMenuProps) {
  return (
    <div className="relative">
      <button
        type="button"
        onClick={onToggle}
        data-testid="chat-actions-toggle"
        className="btn btn-ghost btn-circle btn-sm md:btn-md"
      >
        <RiAddLine size={20} />
      </button>

      {isOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={onClose} />
          <div className="absolute bottom-full left-0 mb-2 w-48 bg-base-200 rounded-lg shadow-lg border border-base-300 z-50 overflow-hidden">
            <button
              type="button"
              onClick={() => {
                onAttachmentClick()
                onClose()
              }}
              data-testid="chat-attachment-button"
              disabled={attachmentDisabled}
              className="w-full btn btn-ghost justify-start rounded-none hover:bg-base-300"
            >
              <div className="flex items-center gap-2">
                <RiAttachment2 size={18} />
                <span>Attachment</span>
              </div>
            </button>
            <button
              type="button"
              onClick={() => {
                onCashuSend()
                onClose()
              }}
              className="w-full btn btn-ghost justify-start rounded-none hover:bg-base-300"
            >
              <div className="flex items-center gap-2">
                <span className="text-lg">₿</span>
                <span>Send ecash</span>
              </div>
            </button>
          </div>
        </>
      )}
    </div>
  )
}
