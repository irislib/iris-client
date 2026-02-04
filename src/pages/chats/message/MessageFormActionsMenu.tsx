import {RiAddLine, RiAttachment2, RiLock2Line} from "@remixicon/react"
import {useFileUpload} from "@/shared/hooks/useFileUpload"
import {processHashtreeFile} from "@/shared/upload/hashtree"
import {useToastStore} from "@/stores/toast"
import type {EncryptionMeta} from "@/types/global"

interface MessageFormActionsMenuProps {
  isOpen: boolean
  onClose: () => void
  onToggle: () => void
  onUpload: (
    url: string,
    metadata?: {width: number; height: number; blurhash: string},
    encryptionMeta?: EncryptionMeta,
    imetaTag?: string[]
  ) => void
  onCashuSend: () => void
  encrypt: boolean
  useHashtreeAttachments?: boolean
}

export default function MessageFormActionsMenu({
  isOpen,
  onClose,
  onToggle,
  onUpload,
  onCashuSend,
  encrypt,
  useHashtreeAttachments = false,
}: MessageFormActionsMenuProps) {
  const {addToast} = useToastStore()

  const fileUpload = useFileUpload({
    onUpload: (url, metadata, encryptionMeta, imetaTag) => {
      onUpload(url, metadata, encryptionMeta, imetaTag)
      onClose()
    },
    onError: (error) => {
      const errorMsg =
        error.message.length > 100 ? `${error.message.slice(0, 100)}...` : error.message
      addToast(`Upload failed: ${errorMsg}`, "error")
    },
    accept: useHashtreeAttachments ? "" : "image/*,video/*",
    encrypt,
    processFile: useHashtreeAttachments ? processHashtreeFile : undefined,
  })

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
              onClick={fileUpload.triggerUpload}
              data-testid="chat-attachment-button"
              className="w-full btn btn-ghost justify-start rounded-none hover:bg-base-300"
            >
              <div className="flex items-center gap-2">
                <div className="relative">
                  <RiAttachment2 size={18} />
                  {encrypt && (
                    <RiLock2Line size={10} className="absolute -bottom-1 -right-1" />
                  )}
                </div>
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
