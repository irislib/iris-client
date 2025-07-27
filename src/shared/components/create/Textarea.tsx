import {
  ChangeEvent,
  useRef,
  useEffect,
  ClipboardEvent,
  KeyboardEvent,
  useState,
  useCallback,
} from "react"
import {searchIndex, SearchResult} from "@/utils/profileSearch"
import {NostrEvent} from "nostr-tools"
import {UserRow} from "../user/UserRow"
import {nip19} from "nostr-tools"

interface TextareaProps {
  value: string
  onChange: (event: ChangeEvent<HTMLTextAreaElement>) => void
  onUpload: (file: File) => void
  onPublish: () => void
  quotedEvent?: NostrEvent
  placeholder: string
  onRef: (ref: HTMLTextAreaElement) => void
}

const Textarea = ({
  value,
  onChange,
  onUpload,
  onPublish,
  placeholder,
  quotedEvent,
  onRef,
}: TextareaProps) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [mentionSearch, setMentionSearch] = useState<string | null>(null)
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [cursorPosition, setCursorPosition] = useState<{
    top: number
    left: number
  } | null>(null)
  const [selectedIndex, setSelectedIndex] = useState<number>(0)
  const searchResultsRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (textareaRef.current) {
      onRef(textareaRef.current)
    }
  }, [textareaRef.current])

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto"
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`
    }
  }, [value])

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.focus()
      if (quotedEvent) {
        textareaRef.current.setSelectionRange(0, 0)
      }
    }
  }, [textareaRef.current, quotedEvent])

  useEffect(() => {
    if (mentionSearch) {
      const results = searchIndex
        .search(mentionSearch, {limit: 10})
        .map((result) => result.item)
      setSearchResults(results)
    } else {
      setSearchResults([])
    }
  }, [mentionSearch])

  useEffect(() => {
    if (searchResults.length > 0) {
      setSelectedIndex(0)
    } else {
      setSelectedIndex(-1)
    }
  }, [searchResults])

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault()
      if (value) {
        onPublish()
      }
    } else if (searchResults.length > 0) {
      switch (event.key) {
        case "ArrowDown":
          event.preventDefault()
          setSelectedIndex((prevIndex) =>
            prevIndex < searchResults.length - 1 ? prevIndex + 1 : 0
          )
          break
        case "ArrowUp":
          event.preventDefault()
          setSelectedIndex((prevIndex) =>
            prevIndex > 0 ? prevIndex - 1 : searchResults.length - 1
          )
          break
        case "Tab":
          event.preventDefault()
          if (event.shiftKey) {
            setSelectedIndex((prevIndex) =>
              prevIndex > 0 ? prevIndex - 1 : searchResults.length - 1
            )
          } else {
            setSelectedIndex((prevIndex) =>
              prevIndex < searchResults.length - 1 ? prevIndex + 1 : 0
            )
          }
          break
        case "Enter":
          event.preventDefault()
          if (selectedIndex >= 0) {
            handleSelectMention(searchResults[selectedIndex])
          }
          break
        case "Escape":
          setMentionSearch(null)
          setSelectedIndex(-1)
          event.preventDefault()
          break
      }
    }
  }

  const handlePaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    if (event.clipboardData) {
      const items = Array.from(event.clipboardData.items)
      const mediaItem = items.find((item) => /^(image|video)\//.test(item.type))

      if (mediaItem) {
        const blob = mediaItem.getAsFile()
        if (blob) {
          onUpload(blob)
        }
      }
    }
  }

  const handleInputChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    onChange(event)
    const value = event.target.value
    const cursorPosition = event.target.selectionStart

    // Updated regex to match '@' only if preceded by whitespace or start of string
    const mentionRegex = /(?:^|\s)@(\S*)$/
    const match = value.slice(0, cursorPosition).match(mentionRegex)

    if (match) {
      const mention = match[1]
      setMentionSearch(mention)
      updateCursorPosition()
    } else {
      setMentionSearch(null)
    }
  }

  const updateCursorPosition = () => {
    if (textareaRef.current) {
      const {offsetLeft, offsetTop, scrollTop, selectionEnd} = textareaRef.current
      const {lineHeight} = getComputedStyle(textareaRef.current)
      const lines = textareaRef.current.value.substr(0, selectionEnd).split("\n")
      const lineNumber = lines.length - 1

      setCursorPosition({
        left: offsetLeft,
        top: offsetTop + parseInt(lineHeight) * lineNumber - scrollTop,
      })
    }
  }

  const handleSelectMention = (result: SearchResult) => {
    if (textareaRef.current) {
      const currentValue = textareaRef.current.value
      const cursorPosition = textareaRef.current.selectionStart

      // Updated regex to match '@' only if preceded by whitespace or start of string
      const mentionRegex = /(?:^|\s)@\S*$/
      const lastMentionStart = currentValue.slice(0, cursorPosition).search(mentionRegex)

      const mentionText = `nostr:${nip19.npubEncode(result.pubKey)} `
      const newValue =
        currentValue.slice(0, lastMentionStart) +
        (lastMentionStart > 0 ? currentValue[lastMentionStart] : "") + // Preserve the space if it exists
        mentionText +
        currentValue.slice(cursorPosition)

      onChange({target: {value: newValue}} as ChangeEvent<HTMLTextAreaElement>)
      setMentionSearch(null)

      // Set cursor to after added mention
      const newCursorPosition =
        lastMentionStart + mentionText.length + (lastMentionStart > 0 ? 1 : 0)
      setTimeout(() => {
        if (textareaRef.current) {
          textareaRef.current.setSelectionRange(newCursorPosition, newCursorPosition)
          textareaRef.current.focus()
        }
      }, 0)
    }
  }

  const scrollActiveItemIntoView = useCallback(() => {
    if (searchResultsRef.current && selectedIndex >= 0) {
      const activeItem = searchResultsRef.current.children[selectedIndex] as HTMLElement
      if (activeItem) {
        activeItem.scrollIntoView({block: "nearest"})
      }
    }
  }, [selectedIndex])

  useEffect(() => {
    scrollActiveItemIntoView()
  }, [selectedIndex, scrollActiveItemIntoView])

  return (
    <div className="flex flex-col relative">
      <textarea
        ref={textareaRef}
        className="textarea text-base border-none focus:outline-none p-0 rounded-none min-h-32 max-h-96 bg-transparent"
        value={value}
        placeholder={placeholder}
        onChange={handleInputChange}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
      />
      {searchResults.length > 0 && cursorPosition && (
        <div
          ref={searchResultsRef}
          className="absolute left-0 right-0 bg-base-200 rounded-lg z-10 overflow-hidden mt-2 max-h-60 overflow-y-auto"
          style={{top: `${cursorPosition.top + 20}px`}}
        >
          {searchResults.map((result, index) => (
            <div
              key={result.pubKey}
              className={`p-2 hover:bg-neutral cursor-pointer ${
                index === selectedIndex ? "bg-neutral" : ""
              }`}
              onClick={() => handleSelectMention(result)}
            >
              <UserRow pubKey={result.pubKey} linkToProfile={false} avatarWidth={24} />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default Textarea
