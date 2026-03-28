import {useState, useRef} from "react"
import {NDKEvent} from "@/lib/ndk"
import {Avatar} from "@/shared/components/user/Avatar"
import {ProfileLink} from "@/shared/components/user/ProfileLink"
import {usePublicKey} from "@/stores/user"
import {ndk} from "@/utils/ndk"
import {type UploadState} from "@/shared/components/button/UploadButton"
import {RiAttachment2} from "@remixicon/react"
import {KIND_TEXT_NOTE, KIND_CLASSIFIED} from "@/utils/constants"
import {useNoteCreatorState} from "./hooks/useNoteCreatorState"
import {useMentionAutocomplete} from "./hooks/useMentionAutocomplete"
import {useNoteDraft} from "./hooks/useNoteDraft"
import {useNotePublisher} from "./hooks/useNotePublisher"
import {useDragAndDrop} from "./hooks/useDragAndDrop"
import {useTextareaAutosize} from "./hooks/useTextareaAutosize"
import {useNoteCreatorHandlers} from "./hooks/useNoteCreatorHandlers"
import {useNoteCreatorEffects} from "./hooks/useNoteCreatorEffects"
import {ReplyPreview} from "./components/ReplyPreview"
import {MarketListingFields} from "./components/MarketListingFields"
import {NoteTextarea} from "./components/NoteTextarea"
import {NoteActions} from "./components/NoteActions"
import {UploadProgress} from "./components/UploadProgress"
import {MentionDropdown} from "./components/MentionDropdown"
import {GeohashDisplay} from "./components/GeohashDisplay"

interface BaseNoteCreatorProps {
  onClose?: () => void
  replyingTo?: NDKEvent
  quotedEvent?: NDKEvent
  placeholder?: string
  autofocus?: boolean
  className?: string
  showPreview?: boolean
  variant?: "inline" | "modal"
  onPublish?: (event: NDKEvent) => void
  expandOnFocus?: boolean
  alwaysExpanded?: boolean
}

export function BaseNoteCreator({
  onClose,
  replyingTo,
  quotedEvent,
  placeholder = "What's happening?",
  autofocus = false,
  className = "",
  showPreview = false,
  variant = "inline",
  onPublish: onPublishCallback,
  expandOnFocus = false,
  alwaysExpanded = false,
}: BaseNoteCreatorProps) {
  const myPubKey = usePublicKey()
  const ndkInstance = ndk()

  const draftKey = replyingTo?.id || (quotedEvent ? `quote-${quotedEvent.id}` : "") || ""

  const [state, dispatch] = useNoteCreatorState()
  const {clearDraft, draftStore} = useNoteDraft(draftKey, state, dispatch, quotedEvent)

  const [isFocused, setIsFocused] = useState(false)
  const [previewMode, setPreviewMode] = useState(false)
  const [uploadState, setUploadState] = useState<UploadState>({
    uploading: false,
    progress: 0,
    currentFile: null,
    errorMessage: null,
    failedFiles: [],
    totalFiles: 0,
    currentFileIndex: 0,
  })

  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const draft = draftStore.getDraft(draftKey)
  const {publish, publishing} = useNotePublisher({
    ndkInstance,
    myPubKey,
    replyingTo,
    quotedEvent,
    draftKey,
    gTags: draft?.gTags,
    onPublishSuccess: () => {
      clearDraft() // Clear draft BEFORE reset to prevent useEffect re-persistence
      dispatch({type: "RESET"})
      setIsFocused(false)
    },
  })

  const mention = useMentionAutocomplete(state.text, textareaRef, containerRef)

  const isModal = variant === "modal"
  const drag = useDragAndDrop({
    containerRef,
    isModal,
    expandOnFocus,
    isFocused,
    onFocusChange: setIsFocused,
  })

  useTextareaAutosize(textareaRef, state.text, isFocused, expandOnFocus)

  const handlers = useNoteCreatorHandlers({
    state,
    dispatch,
    textareaRef,
    publish,
    mentionSearch: mention.mentionSearch,
    searchResults: mention.searchResults,
    selectedMentionIndex: mention.selectedMentionIndex,
    handleSelectMention: mention.handleSelectMention,
    moveMentionSelection: mention.moveMentionSelection,
    clearMention: mention.clearMention,
    detectMention: mention.detectMention,
    expandOnFocus,
    isFocused,
    setIsFocused,
    replyingTo,
    onClose,
    onPublishCallback,
  })

  useNoteCreatorEffects({
    autofocus,
    quotedEvent,
    textareaRef,
    expandOnFocus,
    text: state.text,
    containerRef,
    setIsFocused,
  })

  if (!myPubKey) return null

  const effectiveEventKind = replyingTo ? KIND_TEXT_NOTE : state.eventKind
  const shouldExpand = Boolean(
    alwaysExpanded || !expandOnFocus || isFocused || state.text.trim()
  )
  const containerClass = isModal
    ? "flex flex-col gap-4 pt-4"
    : `border-b border-custom ${className}`

  return (
    <div
      ref={containerRef}
      className={`${containerClass} ${drag.isDragOver ? "relative" : ""} relative`}
      onDragEnter={drag.handleDragEnter}
      onDragLeave={drag.handleDragLeave}
      onDragOver={drag.handleDragOver}
      onDrop={drag.handleDrop}
    >
      {drag.isDragOver && (
        <div className="absolute inset-0 bg-primary/20 border-2 border-dashed border-primary rounded-lg flex items-center justify-center z-10 pointer-events-none">
          <div className="text-center">
            <RiAttachment2 className="w-8 h-8 mx-auto mb-2 text-primary" />
            <p className="text-primary font-medium">Drop files to upload</p>
          </div>
        </div>
      )}

      {showPreview && shouldExpand && (
        <div className="flex justify-between items-center px-4 pb-3">
          <div className="flex gap-2">
            <button
              onClick={() => setPreviewMode(false)}
              className={!previewMode ? "btn btn-primary btn-sm" : "btn btn-ghost btn-sm"}
            >
              Edit
            </button>
            <button
              onClick={() => setPreviewMode(true)}
              className={previewMode ? "btn btn-primary btn-sm" : "btn btn-ghost btn-sm"}
            >
              Preview
            </button>
          </div>
          {!replyingTo && (
            <select
              value={state.eventKind}
              onChange={(e) =>
                dispatch({type: "SET_EVENT_KIND", payload: Number(e.target.value)})
              }
              className="select select-sm select-bordered"
              disabled={publishing}
            >
              <option value={KIND_TEXT_NOTE}>Post</option>
              <option value={KIND_CLASSIFIED}>Market Listing</option>
            </select>
          )}
        </div>
      )}

      {isModal && replyingTo && <ReplyPreview replyingTo={replyingTo} />}

      <div className={isModal ? "flex gap-4 px-4" : "flex gap-3 px-4 py-3"}>
        <ProfileLink pubKey={myPubKey} className="flex-shrink-0">
          <Avatar pubKey={myPubKey} width={40} showBadge={false} />
        </ProfileLink>

        <div className="flex-1">
          {effectiveEventKind === KIND_CLASSIFIED && shouldExpand && !previewMode && (
            <MarketListingFields
              title={state.title}
              price={state.price}
              onTitleChange={(title) => dispatch({type: "SET_TITLE", payload: title})}
              onPriceChange={(price) => dispatch({type: "SET_PRICE", payload: price})}
              disabled={publishing}
            />
          )}

          <NoteTextarea
            textareaRef={textareaRef}
            text={state.text}
            onTextChange={handlers.handleTextChange}
            onFocus={() => setIsFocused(true)}
            onKeyDown={handlers.handleKeyDown}
            placeholder={
              effectiveEventKind === KIND_CLASSIFIED ? "Description" : placeholder
            }
            previewMode={previewMode}
            isModal={isModal}
            shouldExpand={shouldExpand}
          />
        </div>
      </div>

      {(isModal || shouldExpand) && (
        <div className={isModal ? "px-4 pb-4" : "px-4 pb-3"}>
          <GeohashDisplay
            draftKey={draftKey}
            expirationDelta={state.expirationDelta}
            disabled={publishing}
          />

          <NoteActions
            onEmojiSelect={handlers.handleEmojiSelect}
            onUpload={handlers.handleUpload}
            onUploadStateChange={setUploadState}
            onExpirationChange={(delta) =>
              dispatch({type: "SET_EXPIRATION_DELTA", payload: delta})
            }
            onSubmit={handlers.handleSubmit}
            onClose={onClose}
            draftKey={draftKey}
            isModal={isModal}
            isReplying={!!replyingTo}
            canSubmit={!!state.text.trim()}
            publishing={publishing}
            expirationDelta={state.expirationDelta}
          />

          <UploadProgress
            uploadState={uploadState}
            onDismissError={() =>
              setUploadState((prev) => ({
                ...prev,
                errorMessage: null,
                failedFiles: [],
              }))
            }
            onDismissFailedFiles={() =>
              setUploadState((prev) => ({...prev, failedFiles: []}))
            }
          />
        </div>
      )}

      {mention.mentionCursorPosition && (
        <MentionDropdown
          searchResults={mention.searchResults}
          selectedIndex={mention.selectedMentionIndex}
          position={mention.mentionCursorPosition}
          onSelect={(result) =>
            mention.handleSelectMention(result, handlers.handleTextChange)
          }
        />
      )}
    </div>
  )
}
