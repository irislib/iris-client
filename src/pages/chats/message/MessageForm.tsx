import {
  FormEvent,
  useState,
  useEffect,
  useMemo,
  ChangeEvent,
  ClipboardEvent as ReactClipboardEvent,
  DragEvent as ReactDragEvent,
  KeyboardEvent as ReactKeyboardEvent,
} from "react"
import type {EncryptionMeta as BaseEncryptionMeta} from "@/types/global"
import {useAutosizeTextarea} from "@/shared/hooks/useAutosizeTextarea"
import {useFileUpload} from "@/shared/hooks/useFileUpload"
import EmojiButton from "@/shared/components/emoji/EmojiButton"
import MessageFormReplyPreview from "./MessageFormReplyPreview"
import MessageFormActionsMenu from "./MessageFormActionsMenu"
import CashuSendDialog from "./CashuSendDialog"
import {isTouchDevice} from "@/shared/utils/isTouchDevice"
import {processHashtreeFile} from "@/shared/upload/hashtree"
import Icon from "@/shared/components/Icons/Icon"
import {Link} from "@/navigation"
import EmojiType from "@/types/emoji"
import {MessageType} from "./Message"
import {getSessionManager} from "@/shared/services/PrivateChats"
import {usePrivateMessagesStore} from "@/stores/privateMessages"
import {useUserStore} from "@/stores/user"
import {useDevicesStore} from "@/stores/devices"
import {sendGroupEvent} from "../utils/groupMessaging"
import {GROUP_SENDER_KEY_MESSAGE_KIND} from "nostr-double-ratchet"
import {useRecipientHasAppKeys} from "../hooks/useRecipientHasAppKeys"
import {createTypingThrottle} from "@/stores/typingIndicators"
import {useChatExpirationStore} from "@/stores/chatExpiration"
import {useToastStore} from "@/stores/toast"

interface MessageFormProps {
  id: string
  replyingTo?: MessageType
  setReplyingTo: (message?: MessageType) => void
  onSendMessage?: (content: string) => Promise<void>
  isPublicChat?: boolean
  groupId?: string
  groupMembers?: string[]
}

// Extend EncryptionMeta locally to allow imetaTag
interface EncryptionMetaWithImeta extends BaseEncryptionMeta {
  imetaTag?: string[]
}

const hasFileData = (dataTransfer: DataTransfer | null) => {
  if (!dataTransfer) return false
  return (
    dataTransfer.files.length > 0 ||
    Array.from(dataTransfer.types || []).includes("Files")
  )
}

const getFirstFileFromTransfer = (dataTransfer: DataTransfer | null): File | null => {
  if (!dataTransfer) return null
  if (dataTransfer.files.length > 0) {
    return dataTransfer.files[0]
  }

  for (const item of Array.from(dataTransfer.items || [])) {
    if (item.kind !== "file") continue
    const file = item.getAsFile()
    if (file) return file
  }

  return null
}

const resolveDmExpirationOptions = (
  peerPubkey: string
):
  | Record<string, never>
  | {expiration: null}
  | {
      ttlSeconds: number
    } => {
  const expirationSetting = useChatExpirationStore.getState().expirations[peerPubkey]
  if (expirationSetting === undefined) return {}
  if (expirationSetting === null) return {expiration: null}
  if (typeof expirationSetting === "number" && expirationSetting > 0) {
    return {ttlSeconds: expirationSetting}
  }
  return {}
}

const MessageForm = ({
  id,
  replyingTo,
  setReplyingTo,
  onSendMessage,
  isPublicChat = false,
  groupId,
  groupMembers,
}: MessageFormProps) => {
  const {canSendPrivateMessages, appKeysManagerReady, sessionManagerReady} =
    useDevicesStore()
  const {addToast} = useToastStore()
  const [newMessage, setNewMessage] = useState("")
  const [encryptionMetadata, setEncryptionMetadata] = useState<
    Map<string, EncryptionMetaWithImeta>
  >(new Map())
  const [showActionsMenu, setShowActionsMenu] = useState(false)
  const [showCashuSend, setShowCashuSend] = useState(false)
  const textareaRef = useAutosizeTextarea(newMessage)
  const isDM = !isPublicChat && !groupId
  const dmRecipientPubkey = isDM ? id.split(":").shift()! : id
  const typingThrottle = useMemo(
    () =>
      createTypingThrottle(() => {
        if (!isDM) return
        const sessionManager = getSessionManager()
        if (!sessionManager) return
        sessionManager.sendTyping(dmRecipientPubkey).catch(() => {})
      }, 3000),
    [dmRecipientPubkey, isDM]
  )

  useEffect(() => {
    if (!isTouchDevice && textareaRef.current) {
      textareaRef.current.focus()
    }

    if (replyingTo && textareaRef.current) {
      textareaRef.current.focus()
    }

    const handleEscKey = (event: Event) => {
      const keyboardEvent = event as unknown as ReactKeyboardEvent
      if (keyboardEvent.key === "Escape" && replyingTo) {
        setReplyingTo(undefined)
      }
    }

    document.addEventListener("keydown", handleEscKey)
    return () => document.removeEventListener("keydown", handleEscKey)
  }, [id, isTouchDevice, replyingTo, setReplyingTo])

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    const isPrivateOrGroupChat = !isPublicChat || groupId
    if (isPrivateOrGroupChat && !canSendPrivateMessages) return
    const text = newMessage.trim()
    if (!text) return

    setNewMessage("")
    typingThrottle.reset()
    if (replyingTo) {
      setReplyingTo(undefined)
    }
    if (onSendMessage) {
      onSendMessage(text).catch((error) => {
        console.error("Failed to send message:", error)
      })
      return
    }

    try {
      const sessionManager = getSessionManager()
      if (!sessionManager) {
        console.error("Session manager not available")
        return
      }

      const myPubKey = useUserStore.getState().publicKey
      if (!myPubKey) return

      // Build tags (shared for DMs and groups)
      const extraTags: string[][] = []
      if (replyingTo) {
        extraTags.push(["e", replyingTo.id, "", "reply"])
      }
      // Add imeta tags for encrypted files
      encryptionMetadata.forEach((meta, url) => {
        if (text.includes(url) && meta.imetaTag) {
          extraTags.push(meta.imetaTag)
        }
      })

      // Handle group messages
      if (groupId && groupMembers) {
        await sendGroupEvent({
          groupId,
          groupMembers,
          senderPubKey: myPubKey,
          content: text,
          kind: GROUP_SENDER_KEY_MESSAGE_KIND,
          extraTags,
        })

        setEncryptionMetadata(new Map())
        return
      }

      // DM messages
      const expirationOptions = resolveDmExpirationOptions(dmRecipientPubkey)

      const sentMessage =
        extraTags.length > 0
          ? await sessionManager.sendMessage(dmRecipientPubkey, text, {
              tags: extraTags,
              ...expirationOptions,
            })
          : await sessionManager.sendMessage(dmRecipientPubkey, text, expirationOptions)

      await usePrivateMessagesStore
        .getState()
        .upsert(dmRecipientPubkey, myPubKey, {...sentMessage, ownerPubkey: myPubKey})
      setEncryptionMetadata(new Map())
    } catch (error) {
      console.error("Failed to send message:", error)
    }
  }

  const handleInputChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value
    setNewMessage(value)
    if (isDM && value.trim().length > 0) {
      typingThrottle.fire()
    }
  }

  const handleKeyDown = (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (isTouchDevice) return

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSubmit(e as unknown as FormEvent)
    }
  }

  const handleEmojiClick = (emoji: EmojiType) => {
    setNewMessage((prev) => prev + emoji.native)
    textareaRef.current?.focus()
  }

  const handleUpload = (
    url: string,
    _metadata?: {width: number; height: number; blurhash: string},
    encryptionMeta?: EncryptionMetaWithImeta,
    imetaTag?: string[]
  ) => {
    setNewMessage((prev) => (prev ? prev + " " + url : url))
    if (encryptionMeta) {
      setEncryptionMetadata((prev) =>
        new Map(prev).set(url, {...encryptionMeta, imetaTag})
      )
    }
    textareaRef.current?.focus()
  }

  // Check if recipient has app keys (only for DMs, not group chats)
  const {hasAppKeys: recipientHasAppKeys} = useRecipientHasAppKeys(
    isDM ? dmRecipientPubkey : undefined
  )

  // For private/group chats, check if device is registered
  const isPrivateOrGroupChat = !isPublicChat || groupId
  const isInitializing =
    isPrivateOrGroupChat && (!appKeysManagerReady || !sessionManagerReady)
  const needsSetup = isPrivateOrGroupChat && !isInitializing && !canSendPrivateMessages
  const recipientNotSetup =
    isDM && canSendPrivateMessages && recipientHasAppKeys === false
  const isDisabled =
    !!(isPrivateOrGroupChat && !canSendPrivateMessages) || recipientNotSetup

  const fileUpload = useFileUpload({
    onUpload: (url, metadata, encryptionMeta, imetaTag) => {
      handleUpload(
        url,
        metadata,
        encryptionMeta as EncryptionMetaWithImeta | undefined,
        imetaTag
      )
    },
    onError: (error) => {
      const errorMsg =
        error.message.length > 100 ? `${error.message.slice(0, 100)}...` : error.message
      addToast(`Upload failed: ${errorMsg}`, "error")
    },
    accept: isPublicChat ? "image/*,video/*" : "",
    processFile: isPublicChat ? undefined : processHashtreeFile,
  })

  const handleAttachmentFile = (file: File) => {
    if (isDisabled || fileUpload.uploading) return
    void fileUpload.uploadFile(file)
  }

  const handleDragOver = (e: ReactDragEvent<HTMLElement>) => {
    if (!hasFileData(e.dataTransfer)) return
    e.preventDefault()
  }

  const handleDrop = (e: ReactDragEvent<HTMLElement>) => {
    const file = getFirstFileFromTransfer(e.dataTransfer)
    if (!file) return
    e.preventDefault()
    e.stopPropagation()
    handleAttachmentFile(file)
  }

  const handlePaste = (e: ReactClipboardEvent<HTMLTextAreaElement>) => {
    const file = getFirstFileFromTransfer(e.clipboardData)
    if (!file) return
    e.preventDefault()
    handleAttachmentFile(file)
  }

  const handleCashuSendMessage = async (token: string) => {
    try {
      const sessionManager = getSessionManager()
      if (!sessionManager) {
        console.error("Session manager not available")
        return
      }

      const myPubKey = useUserStore.getState().publicKey
      if (!myPubKey) return

      // Handle group messages
      if (groupId && groupMembers) {
        await sendGroupEvent({
          groupId,
          groupMembers,
          senderPubKey: myPubKey,
          content: token,
          kind: GROUP_SENDER_KEY_MESSAGE_KIND,
        })
        return
      }

      // DM messages
      const expirationOptions = resolveDmExpirationOptions(dmRecipientPubkey)

      const sentMessage = await sessionManager.sendMessage(
        dmRecipientPubkey,
        token,
        expirationOptions
      )
      await usePrivateMessagesStore
        .getState()
        .upsert(dmRecipientPubkey, myPubKey, {...sentMessage, ownerPubkey: myPubKey})
    } catch (error) {
      console.error("Failed to send cashu token:", error)
      throw error
    }
  }

  return (
    <footer
      className="fixed md:sticky bottom-0 w-full bg-base-200 relative pb-[env(safe-area-inset-bottom,0px)]"
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {(isInitializing || needsSetup || recipientNotSetup) && (
        <div className="absolute bottom-full left-0 right-0 px-4 py-2 text-xs bg-base-200">
          {isInitializing && (
            <div className="flex items-center gap-2 text-base-content/60">
              <span className="loading loading-spinner loading-xs" />
              <span>Initializing private messaging...</span>
            </div>
          )}
          {needsSetup && (
            <Link to="/chats/new/devices" className="text-primary hover:underline">
              Set up private messaging
            </Link>
          )}
          {recipientNotSetup && (
            <span className="text-base-content/60">
              This user has not enabled encrypted messaging yet
            </span>
          )}
        </div>
      )}
      <div className="border-t border-custom">
        {replyingTo && (
          <MessageFormReplyPreview
            replyingTo={replyingTo}
            setReplyingTo={setReplyingTo}
          />
        )}
        <div className="flex gap-2 p-4 relative">
          <MessageFormActionsMenu
            isOpen={showActionsMenu}
            onClose={() => setShowActionsMenu(false)}
            onToggle={() => setShowActionsMenu(!showActionsMenu)}
            onAttachmentClick={fileUpload.triggerUpload}
            onCashuSend={() => setShowCashuSend(true)}
            attachmentDisabled={isDisabled || fileUpload.uploading}
          />

          <CashuSendDialog
            isOpen={showCashuSend}
            onClose={() => setShowCashuSend(false)}
            onSendMessage={handleCashuSendMessage}
            recipientPubKey={groupId ? undefined : id}
          />

          <form onSubmit={handleSubmit} className="flex-1 flex gap-2 items-center">
            <div className="relative flex-1">
              <div className="flex gap-2 items-center">
                {!isTouchDevice && <EmojiButton onEmojiSelect={handleEmojiClick} />}
                <textarea
                  ref={textareaRef}
                  value={newMessage}
                  onChange={handleInputChange}
                  onKeyDown={handleKeyDown}
                  onPaste={handlePaste}
                  placeholder="Message"
                  className={`flex-1 textarea !text-left leading-tight resize-none py-2.5 min-h-[2.5rem] ${
                    newMessage.includes("\n") ? "rounded-lg" : "rounded-full"
                  } ${isDisabled ? "opacity-50 cursor-not-allowed" : ""}`}
                  aria-label="Message input"
                  rows={1}
                  disabled={isDisabled}
                />
              </div>
            </div>
            <button
              type="submit"
              className={`btn btn-primary btn-circle btn-sm md:btn-md ${
                isTouchDevice ? "" : "hidden"
              }`}
              aria-label="Send message"
              disabled={isDisabled || !newMessage.trim()}
            >
              <Icon name="arrow-right" className="-rotate-90" />
            </button>
          </form>
        </div>
      </div>
    </footer>
  )
}

export default MessageForm
