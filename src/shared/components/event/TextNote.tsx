import {TranslatableText} from "@/shared/components/Translation"
import {AppEvent} from "@/lib/nostr"

import ErrorBoundary from "../ui/ErrorBoundary"

type TextNoteProps = {
  event: AppEvent
  truncate?: number
}

function TextNote({event, truncate}: TextNoteProps) {
  return (
    <ErrorBoundary>
      <TranslatableText event={event} truncate={truncate}>
        {event?.content || ""}
      </TranslatableText>
    </ErrorBoundary>
  )
}

export default TextNote
