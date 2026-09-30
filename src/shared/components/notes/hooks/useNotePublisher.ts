import {useState, useRef} from "react"
import {groupAddress, type GroupRef} from "@/groups/model"
import {publishGroupEvent} from "@/groups/publish"
import NostrClient, {AppEvent, EventKind} from "@/lib/nostr"
import {NoteCreatorState} from "./useNoteCreatorState"
import {buildEventTags} from "../utils/eventTags"
import {cacheEvent} from "@/utils/eventCache"
import {useToastStore} from "@/stores/toast"

interface UseNotePublisherParams {
  ndkInstance: NostrClient | undefined
  myPubKey: string | undefined
  replyingTo?: AppEvent
  quotedEvent?: AppEvent
  draftKey: string
  gTags?: string[]
  group?: GroupRef
  canPublish?: boolean
  onPublishSuccess: () => void
}

export function useNotePublisher(params: UseNotePublisherParams) {
  const [publishing, setPublishing] = useState(false)
  const inFlight = useRef(false)

  const publish = async (state: NoteCreatorState) => {
    const {myPubKey, ndkInstance} = params

    if (
      !myPubKey ||
      !ndkInstance ||
      !state.text.trim() ||
      inFlight.current ||
      params.canPublish === false
    ) {
      return false
    }

    inFlight.current = true
    setPublishing(true)
    try {
      const effectiveEventKind =
        params.replyingTo || params.group ? EventKind.Text : state.eventKind
      const replyingTo = params.replyingTo
      if (replyingTo) {
        replyingTo.nostr ??= ndkInstance
      }
      const event = replyingTo ? replyingTo.reply() : new AppEvent(ndkInstance)
      event.nostr ??= ndkInstance

      if (!params.replyingTo) {
        event.kind = effectiveEventKind as EventKind
      }

      event.content = state.text
      event.tags = buildEventTags({
        replyingTo: params.replyingTo,
        initialTags: params.replyingTo ? event.tags : undefined,
        includeReplyTags: !params.replyingTo,
        quotedEvent: params.quotedEvent,
        imeta: state.imeta,
        gTags: params.gTags,
        text: state.text,
        expirationDelta: state.expirationDelta,
        eventKind: effectiveEventKind,
        title: state.title,
        price: state.price,
        myPubKey,
      })

      if (params.group) {
        event.tags = event.tags.filter(
          (tag) => tag[0] !== "h" && !(tag[0] === "a" && tag[1]?.startsWith("37368:"))
        )
        event.tags.push(["h", params.group.id], ["a", groupAddress(params.group)])
      }

      // Validate tags are all valid arrays
      event.tags = event.tags.filter(
        (tag) => Array.isArray(tag) && tag.every((item) => typeof item === "string")
      )

      if (params.group) {
        await publishGroupEvent(event)
      } else {
        await event.sign()
        // Publication commits the offline outbox before the draft is cleared.
        await event.publish()
        cacheEvent(event)
      }
      setPublishing(false)
      params.onPublishSuccess()

      return {
        success: true,
        event,
        eventId: event.id,
      }
    } catch (error) {
      console.error("Failed to create note:", error)
      const detail =
        error instanceof Error
          ? error.message.trim()
          : typeof error === "string"
            ? error.trim()
            : ""
      const action = params.replyingTo ? "reply" : "post"
      const message = detail
        ? `Could not publish ${action}: ${detail}`
        : `Could not publish ${action}. Please try again.`
      useToastStore.getState().addToast(message, "error")
      setPublishing(false)
      return {
        success: false,
        event: null,
        eventId: null,
      }
    } finally {
      inFlight.current = false
      setPublishing(false)
    }
  }

  return {
    publish,
    publishing,
  }
}
