import {useState} from "react"
import NDK, {NDKEvent, NDKKind} from "@/lib/ndk"
import {NoteCreatorState} from "./useNoteCreatorState"
import {buildEventTags} from "../utils/eventTags"
import {cacheEvent} from "@/utils/eventCache"

interface UseNotePublisherParams {
  ndkInstance: NDK | undefined
  myPubKey: string | undefined
  replyingTo?: NDKEvent
  quotedEvent?: NDKEvent
  draftKey: string
  gTags?: string[]
  onPublishSuccess: () => void
}

export function useNotePublisher(params: UseNotePublisherParams) {
  const [publishing, setPublishing] = useState(false)

  const publish = async (state: NoteCreatorState) => {
    if (!params.myPubKey || !params.ndkInstance || !state.text.trim() || publishing) {
      return false
    }

    setPublishing(true)
    try {
      const event = new NDKEvent(params.ndkInstance)
      event.kind = state.eventKind as NDKKind
      event.content = state.text
      event.tags = buildEventTags({
        replyingTo: params.replyingTo,
        quotedEvent: params.quotedEvent,
        imeta: state.imeta,
        gTags: params.gTags,
        text: state.text,
        expirationDelta: state.expirationDelta,
        eventKind: state.eventKind,
        title: state.title,
        price: state.price,
        myPubKey: params.myPubKey,
      })

      // Validate tags are all valid arrays
      event.tags = event.tags.filter(
        (tag) => Array.isArray(tag) && tag.every((item) => typeof item === "string")
      )

      await event.sign()

      // Add to hot cache immediately for instant detail page loading
      cacheEvent(event)

      // Fire and forget - event is already cached for offline-first behavior
      // Don't await relay responses as that causes spinner to hang
      event.publish().catch((error) => {
        console.error("Failed to publish note:", error)
      })

      setPublishing(false)
      params.onPublishSuccess()

      return {
        success: true,
        eventId: event.id,
      }
    } catch (error) {
      console.error("Failed to create note:", error)
      setPublishing(false)
      return {
        success: false,
        eventId: null,
      }
    }
  }

  return {
    publish,
    publishing,
  }
}
