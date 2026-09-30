import {BaseNoteCreator} from "../notes/BaseNoteCreator"
import {AppEvent} from "@/lib/nostr"

type handleCloseFunction = () => void

interface NoteCreatorProps {
  repliedEvent?: AppEvent
  quotedEvent?: AppEvent
  handleClose: handleCloseFunction
  reset?: boolean
}

function NoteCreator({handleClose, repliedEvent, quotedEvent}: NoteCreatorProps) {
  return (
    <BaseNoteCreator
      onClose={handleClose}
      replyingTo={repliedEvent}
      quotedEvent={quotedEvent}
      placeholder="What's on your mind?"
      autofocus={true}
      variant="modal"
      showPreview={true}
    />
  )
}

export default NoteCreator
