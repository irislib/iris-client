import {useEffect, Dispatch} from "react"
import {useDraftStore} from "@/stores/draft"
import {NDKEvent} from "@/lib/ndk"
import {nip19} from "nostr-tools"
import {NoteCreatorState, NoteCreatorAction} from "./useNoteCreatorState"

type DraftLoadPayload = Partial<NoteCreatorState>

export function noteCreatorDraftPayload(draft: {
  content?: string
  imeta?: NoteCreatorState["imeta"]
  expirationDelta?: NoteCreatorState["expirationDelta"]
  eventKind?: NoteCreatorState["eventKind"]
  price?: NoteCreatorState["price"]
  title?: NoteCreatorState["title"]
}): DraftLoadPayload {
  const payload: DraftLoadPayload = {}

  if (draft.content !== undefined) payload.text = draft.content
  if (draft.imeta !== undefined) payload.imeta = draft.imeta
  if (draft.expirationDelta !== undefined) payload.expirationDelta = draft.expirationDelta
  if (draft.eventKind !== undefined) payload.eventKind = draft.eventKind
  if (draft.price !== undefined) payload.price = draft.price
  if (draft.title !== undefined) payload.title = draft.title

  return payload
}

export function useNoteDraft(
  draftKey: string,
  state: NoteCreatorState,
  dispatch: Dispatch<NoteCreatorAction>,
  quotedEvent?: NDKEvent
) {
  const draftStore = useDraftStore()
  const hasHydrated = draftStore.hasHydrated

  // Load draft on hydration
  useEffect(() => {
    if (!hasHydrated) return
    const draft = draftStore.getDraft(draftKey)
    if (draft) {
      dispatch({
        type: "LOAD_DRAFT",
        payload: noteCreatorDraftPayload(draft),
      })
    } else if (quotedEvent && !state.text) {
      // Set quote link if no existing draft
      const noteId = nip19.noteEncode(quotedEvent.id)
      dispatch({type: "SET_TEXT", payload: `\n\nnostr:${noteId}`})
    }
  }, [hasHydrated, draftKey, quotedEvent])

  // Persist state to draft store
  useEffect(() => {
    if (!hasHydrated) return
    draftStore.setDraft(draftKey, {content: state.text})
  }, [state.text, draftKey, hasHydrated])

  useEffect(() => {
    if (!hasHydrated) return
    draftStore.setDraft(draftKey, {imeta: state.imeta})
  }, [state.imeta, draftKey, hasHydrated])

  useEffect(() => {
    if (!hasHydrated) return
    draftStore.setDraft(draftKey, {expirationDelta: state.expirationDelta})
  }, [state.expirationDelta, draftKey, hasHydrated])

  useEffect(() => {
    if (!hasHydrated) return
    draftStore.setDraft(draftKey, {eventKind: state.eventKind})
  }, [state.eventKind, draftKey, hasHydrated])

  useEffect(() => {
    if (!hasHydrated) return
    draftStore.setDraft(draftKey, {price: state.price})
  }, [state.price, draftKey, hasHydrated])

  useEffect(() => {
    if (!hasHydrated) return
    draftStore.setDraft(draftKey, {title: state.title})
  }, [state.title, draftKey, hasHydrated])

  const clearDraft = () => {
    draftStore.clearDraft(draftKey)
  }

  return {clearDraft, draftStore}
}
