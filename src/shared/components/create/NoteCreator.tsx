import {ChangeEvent, DragEvent, useEffect, useState} from "react"
import {NDKEvent, NDKTag} from "@nostr-dev-kit/ndk"
import {useNavigate} from "react-router"
import {nip19} from "nostr-tools"

import UploadButton from "@/shared/components/button/UploadButton.tsx"
import FeedItem from "@/shared/components/event/FeedItem/FeedItem"
import EmojiButton from "@/shared/components/emoji/EmojiButton"
import {Avatar} from "@/shared/components/user/Avatar.tsx"
import {isTouchDevice} from "@/shared/utils/isTouchDevice"
import HyperText from "@/shared/components/HyperText.tsx"
import {eventsByIdCache} from "@/utils/memcache"
import {useDraftStore} from "@/stores/draft"
import {processFile} from "@/shared/upload"
import {usePublicKey} from "@/stores/user"
import Textarea from "./Textarea"
import {ndk} from "@/utils/ndk"

type handleCloseFunction = () => void

interface NoteCreatorProps {
  repliedEvent?: NDKEvent
  quotedEvent?: NDKEvent
  handleClose: handleCloseFunction
  reset?: boolean
}

function addTags(event: NDKEvent, repliedEvent?: NDKEvent, quotedEvent?: NDKEvent) {
  const uniquePTags = new Set<string>()
  const eTags: NDKTag[] = []
  const otherTags: NDKTag[] = []

  if (event.pubkey) {
    uniquePTags.add(event.pubkey)
  }

  // Process existing tags
  event.tags.forEach((tag) => {
    if (tag[0] === "p" && tag[1]?.trim()) {
      uniquePTags.add(tag[1])
    } else if (tag[0] === "e" && tag[1]?.trim()) {
      // Store complete e-tag instead of just the ID
      eTags.push(tag)
    } else if (tag[0] !== "p" && tag[0] !== "e") {
      otherTags.push(tag)
    }
  })

  // Add p-tags from events
  if (repliedEvent) {
    if (repliedEvent.pubkey?.trim()) {
      uniquePTags.add(repliedEvent.pubkey)
    }
    // Preserve full e-tag for reply
    if (repliedEvent.id?.trim()) {
      const rootEventTag = repliedEvent.tags.find(
        (tag) => tag[0] === "e" && tag[3] === "root"
      )
      const isDirectReply =
        !rootEventTag &&
        !repliedEvent.tags.find((tag) => tag[0] === "e" && tag[3] === "reply")
      if (rootEventTag) {
        eTags.push(rootEventTag)
      }
      eTags.push([
        "e",
        repliedEvent.id,
        "",
        isDirectReply ? "root" : "reply",
        repliedEvent.pubkey,
      ])
    }
    // Add p-tags from replied event
    repliedEvent.tags.forEach((tag) => {
      if (tag[0] === "p" && tag[1]?.trim()) {
        uniquePTags.add(tag[1])
      }
    })
  }

  if (quotedEvent) {
    if (quotedEvent.pubkey?.trim()) {
      uniquePTags.add(quotedEvent.pubkey)
    }
    // Preserve full e-tag for quote
    if (quotedEvent.id?.trim()) {
      eTags.push(["e", quotedEvent.id, "", "mention", quotedEvent.pubkey])
    }
    // Add p-tags from quoted event
    quotedEvent.tags.forEach((tag) => {
      if (tag[0] === "p" && tag[1]?.trim()) {
        uniquePTags.add(tag[1])
      }
    })
  }

  // Filter out any empty values and reconstruct tags array
  const validPTags = Array.from(uniquePTags).filter(Boolean)

  event.tags = [
    ...validPTags.map<NDKTag>((pubkey) => ["p", pubkey]),
    ...eTags, // Use complete e-tags instead of reconstructing
    ...otherTags,
  ]

  return event
}

function NoteCreator({handleClose, quotedEvent, repliedEvent}: NoteCreatorProps) {
  const myPubKey = usePublicKey()
  const navigate = useNavigate()
  const {
    content: noteContent,
    imageMetadata,
    setContent: setNoteContent,
    setImageMetadata,
    reset: resetDraft,
  } = useDraftStore()

  const [textarea, setTextarea] = useState<HTMLTextAreaElement | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [isDraggingOver, setIsDraggingOver] = useState(false)

  const handleContentChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    setNoteContent(event.target.value)
  }

  useEffect(() => {
    if (quotedEvent) {
      const quote = `nostr:${quotedEvent.encode()}`
      if (!noteContent.includes(quote)) {
        setNoteContent(`\n\n${quote}`)
      }
    }
  }, [quotedEvent])

  const handleUpload = (
    url: string,
    metadata?: {width: number; height: number; blurhash: string}
  ) => {
    if (textarea) {
      // Always append the URL with a line break at the end of the content
      setNoteContent((prev) => prev + `\n${url}\n`)

      // Move cursor to the end of the content
      setTimeout(() => {
        const newPosition = noteContent.length + url.length + 2 // +2 for the line breaks
        textarea.selectionStart = textarea.selectionEnd = newPosition
      }, 0)

      // Store metadata if available
      if (metadata) {
        setImageMetadata({...imageMetadata, [url]: metadata})
      }
    }
  }

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setIsDraggingOver(true)
  }

  const handleDragLeave = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setIsDraggingOver(false)
  }

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setIsDraggingOver(false)
    const files = Array.from(event.dataTransfer.files)
    files.forEach((file) => {
      if (file.type.startsWith("image/") || file.type.startsWith("video/")) {
        handleFileUpload(file)
      }
    })
  }

  const handleFileUpload = async (file: File) => {
    setUploading(true)
    setUploadProgress(0)
    setUploadError(null)
    try {
      const {url, metadata} = await processFile(file, (progress: number) => {
        setUploadProgress(progress)
      })
      handleUpload(url, metadata)
    } catch (error) {
      console.error("File upload failed:", error)
      setUploadError(error instanceof Error ? error.message : String(error))
    } finally {
      setUploading(false)
      setUploadProgress(0)
    }
  }

  const handleEmojiSelect = (emoji: {native: string}) => {
    if (textarea) {
      const start = textarea.selectionStart
      const end = textarea.selectionEnd
      const textBeforeCursor = noteContent.substring(0, start)
      const textAfterCursor = noteContent.substring(end)
      setNoteContent(textBeforeCursor + emoji.native + textAfterCursor)

      // Restore focus and set cursor position after the inserted emoji
      setTimeout(() => {
        textarea.focus()
        const newPosition = start + emoji.native.length
        textarea.setSelectionRange(newPosition, newPosition)
      }, 0)
    }
  }

  const publish = () => {
    const event = new NDKEvent(ndk())
    event.kind = 1
    event.content = noteContent
    event.tags = []

    // Add imeta tags for images that are in the content
    Object.entries(imageMetadata).forEach(([url, metadata]) => {
      if (noteContent.includes(url)) {
        event.tags.push([
          "imeta",
          `url ${url}`,
          `dim ${metadata.width}x${metadata.height}`,
          `blurhash ${metadata.blurhash}`,
        ])
      }
    })

    console.log("event tags:", event.tags)

    addTags(event, repliedEvent, quotedEvent)
    event.sign().then(() => {
      eventsByIdCache.set(event.id, event)
      resetDraft()
      handleClose()
      navigate(`/${nip19.noteEncode(event.id)}`)
    })
    event.publish().catch((error) => {
      console.warn(`Note could not be published: ${error}`)
    })
  }

  return (
    <div
      className={`flex flex-col gap-4 p-4 ${
        isDraggingOver ? "border-2 border-primary" : ""
      }`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {repliedEvent && (
        <div className="p-4 max-h-52 overflow-y-auto border-b border-base-content/20">
          <FeedItem
            event={repliedEvent}
            showActions={false}
            showRepliedTo={false}
            truncate={0}
          />
        </div>
      )}
      <div className="flex gap-4">
        <Avatar pubKey={myPubKey} width={40} />
        <div className="flex-1">
          <Textarea
            value={noteContent}
            onChange={handleContentChange}
            onRef={setTextarea}
            onUpload={handleFileUpload}
            onPublish={publish}
            placeholder="What's on your mind?"
            quotedEvent={quotedEvent}
          />
        </div>
      </div>

      {uploading && (
        <div className="w-full bg-base-200 rounded-full h-2.5">
          <div
            className="bg-primary h-2.5 rounded-full"
            style={{width: `${uploadProgress}%`}}
          ></div>
        </div>
      )}

      {uploadError && <div className="text-error text-sm">{uploadError}</div>}

      <div className="flex justify-between items-center">
        <div className="flex gap-2">
          <UploadButton onUpload={handleUpload} multiple={true} />
          {!isTouchDevice && <EmojiButton onEmojiSelect={handleEmojiSelect} />}
        </div>
        <button
          className="btn btn-primary"
          onClick={publish}
          disabled={!noteContent.trim()}
        >
          Publish
        </button>
      </div>

      <div className="mt-4 min-h-16 max-h-96 overflow-y-scroll">
        <div className="text-sm uppercase text-gray-500 mb-2 font-bold">Preview</div>
        <HyperText>{noteContent}</HyperText>
      </div>
    </div>
  )
}

export default NoteCreator
