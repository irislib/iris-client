import {useState, useEffect, useLayoutEffect, useCallback, RefObject, useRef} from "react"
import {nip19} from "nostr-tools"
import {search, SearchResult} from "@/utils/profileSearch"
import {
  normalizeProfileSearchQuery,
  rankProfileSearchResults,
} from "@/utils/profileSearchRanking"
import {useSocialGraph, useGraphSize} from "@/utils/socialGraph"
import {isOvermuted} from "@/utils/visibility"

interface Mention {
  start: number
  query: string
}

function mentionAtCursor(value: string, cursor: number): Mention | null {
  const match = value.slice(0, cursor).match(/(?:^|\s)@([^\s@]*)$/)
  return match ? {start: cursor - match[1].length - 1, query: match[1]} : null
}

export function useMentionAutocomplete(
  textareaRef: RefObject<HTMLTextAreaElement | null>,
  containerRef: RefObject<HTMLDivElement | null>
) {
  const [mention, setMention] = useState<Mention | null>(null)
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [selectedPubkey, setSelectedPubkey] = useState<string | null>(null)
  const [mentionCursorPosition, setMentionCursorPosition] = useState<{
    top: number
    left: number
  } | null>(null)
  const activeMention = useRef<Mention | null>(null)
  const dismissed = useRef<{value: string; cursor: number} | null>(null)
  const pendingSelection = useRef<{value: string; cursor: number} | null>(null)
  const socialGraph = useSocialGraph()
  const isSocialGraphLoaded = useGraphSize().users > 1
  const selectedMentionIndex = Math.max(
    0,
    searchResults.findIndex((result) => result.pubKey === selectedPubkey)
  )

  // Restore the caret in the same commit as the controlled text update, before
  // another keystroke can land at the end of the textarea.
  useLayoutEffect(() => {
    const textarea = textareaRef.current
    const pending = pendingSelection.current
    if (!textarea || !pending || textarea.value !== pending.value) return
    pendingSelection.current = null
    textarea.focus()
    textarea.setSelectionRange(pending.cursor, pending.cursor)
  })

  useEffect(() => {
    if (!mention?.query) return
    let cancelled = false
    let receivedResults = false
    const isCurrent = () => !cancelled && activeMention.current === mention
    const query = normalizeProfileSearchQuery(mention.query)

    // An exact npub is already an identity; rendering the row fetches its profile.
    try {
      const decoded = nip19.decode(mention.query.replace(/^nostr:/i, ""))
      if (decoded.type === "npub") {
        setSearchResults([{pubKey: decoded.data, name: nip19.npubEncode(decoded.data)}])
        return
      }
    } catch {
      // Incomplete npubs and ordinary names continue through text search.
    }

    const applyResults = (results: Awaited<ReturnType<typeof search>>) => {
      if (!isCurrent()) return
      // A transport timeout returns []; keep any useful partial results.
      if (receivedResults && results.length === 0) return
      receivedResults ||= results.length > 0
      setSearchResults(
        rankProfileSearchResults(
          results.filter((result) => !isOvermuted(result.item.pubKey)),
          query,
          isSocialGraphLoaded ? socialGraph : undefined
        ).slice(0, 10)
      )
    }
    void search(query, applyResults)
      .then(applyResults)
      .catch(() => {
        if (isCurrent() && !receivedResults) setSearchResults([])
      })
    return () => {
      cancelled = true
    }
  }, [mention, socialGraph, isSocialGraphLoaded])

  const clearMention = useCallback(() => {
    const textarea = textareaRef.current
    if (textarea)
      dismissed.current = {value: textarea.value, cursor: textarea.selectionStart}
    activeMention.current = null
    setMention(null)
    setSearchResults([])
    setSelectedPubkey(null)
  }, [textareaRef])

  const detectMention = useCallback(
    (value: string, cursor: number, selectionEnd = cursor) => {
      if (dismissed.current?.value === value && dismissed.current.cursor === cursor)
        return
      dismissed.current = null
      const next = cursor === selectionEnd ? mentionAtCursor(value, cursor) : null
      const previous = activeMention.current
      if (next?.start !== previous?.start || next?.query !== previous?.query) {
        activeMention.current = next
        setMention(next)
        setSearchResults([])
        setSelectedPubkey(null)
      }
      const textarea = textareaRef.current
      const container = containerRef.current
      if (next && textarea && container) {
        const lineHeight = parseFloat(getComputedStyle(textarea).lineHeight) || 24
        const lineCount = value.slice(0, cursor).split("\n").length
        setMentionCursorPosition({
          left: 0,
          top:
            textarea.getBoundingClientRect().top -
            container.getBoundingClientRect().top +
            lineHeight * lineCount,
        })
      }
    },
    [textareaRef, containerRef]
  )

  const handleSelectMention = useCallback(
    (result: SearchResult, onTextChange: (text: string) => void) => {
      const textarea = textareaRef.current
      if (!textarea || textarea.selectionStart !== textarea.selectionEnd) return
      const {value, selectionStart: cursor} = textarea
      const current = mentionAtCursor(value, cursor)
      if (
        !current ||
        current.start !== activeMention.current?.start ||
        current.query !== activeMention.current.query
      )
        return

      // Replace the whole token even when the caret was moved into its middle.
      const end = cursor + (value.slice(cursor).match(/^[^\s@]*/)?.[0].length ?? 0)
      const after = value.slice(end)
      const mentionText = `nostr:${nip19.npubEncode(result.pubKey)}`
      const separator = /^\s/.test(after) ? "" : " "
      const newCursor =
        current.start +
        mentionText.length +
        (after.startsWith(" ") ? 1 : separator.length)
      const newValue = value.slice(0, current.start) + mentionText + separator + after
      pendingSelection.current = {value: newValue, cursor: newCursor}
      onTextChange(newValue)
      clearMention()
    },
    [textareaRef, clearMention]
  )

  const moveMentionSelection = useCallback(
    (direction: "up" | "down") => {
      if (!searchResults.length) return
      const next =
        (selectedMentionIndex + (direction === "down" ? 1 : -1) + searchResults.length) %
        searchResults.length
      setSelectedPubkey(searchResults[next].pubKey)
    },
    [searchResults, selectedMentionIndex]
  )

  return {
    mentionSearch: mention?.query ?? null,
    searchResults,
    selectedMentionIndex,
    mentionCursorPosition,
    detectMention,
    handleSelectMention,
    moveMentionSelection,
    clearMention,
  }
}
