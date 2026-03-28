import {BaseNoteCreator} from "../notes/BaseNoteCreator"
import {NDKEvent} from "@/lib/ndk"

interface InlineNoteCreatorProps {
  onPublish?: (event: NDKEvent) => void
  repliedEvent?: NDKEvent
  placeholder?: string
  className?: string
  alwaysExpanded?: boolean
  showPreview?: boolean
}

function InlineNoteCreator({
  onPublish,
  repliedEvent,
  placeholder = "What's on your mind?",
  className = "",
  alwaysExpanded = false,
  showPreview = false,
}: InlineNoteCreatorProps) {
  const actualPlaceholder = repliedEvent ? "Write your reply..." : placeholder

  return (
    <BaseNoteCreator
      onClose={onPublish ? () => {} : undefined}
      replyingTo={repliedEvent}
      placeholder={actualPlaceholder}
      autofocus={false}
      variant="inline"
      className={className}
      expandOnFocus={!alwaysExpanded}
      alwaysExpanded={alwaysExpanded}
      showPreview={showPreview}
      onPublish={onPublish}
    />
  )
}

export default InlineNoteCreator
