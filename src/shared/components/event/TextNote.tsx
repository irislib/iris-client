import {AppEvent} from "@/lib/nostr"

import HyperText from "@/shared/components/HyperText.tsx"
import ErrorBoundary from "../ui/ErrorBoundary"

type TextNoteProps = {
  event: AppEvent
  truncate?: number
}

function TextNote({event, truncate}: TextNoteProps) {
  return (
    <ErrorBoundary>
      <HyperText event={event} truncate={truncate}>
        {event?.content || ""}
      </HyperText>
    </ErrorBoundary>
  )
}

export default TextNote
