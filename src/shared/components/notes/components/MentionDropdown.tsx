import {useEffect, useRef} from "react"
import {SearchResult} from "@/utils/profileSearch"
import {UserRow} from "@/shared/components/user/UserRow"

interface MentionDropdownProps {
  searchResults: SearchResult[]
  selectedIndex: number
  position: {top: number; left: number}
  onSelect: (result: SearchResult) => void
}

export function MentionDropdown({
  searchResults,
  selectedIndex,
  position,
  onSelect,
}: MentionDropdownProps) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (containerRef.current && selectedIndex >= 0) {
      const activeItem = containerRef.current.children[selectedIndex] as HTMLElement
      if (activeItem) {
        activeItem.scrollIntoView({block: "nearest"})
      }
    }
  }, [selectedIndex])

  if (searchResults.length === 0) {
    return null
  }

  return (
    <div
      ref={containerRef}
      role="listbox"
      aria-label="Mention suggestions"
      className="absolute left-4 right-4 bg-base-200 rounded-lg z-20 overflow-hidden max-h-60 overflow-y-auto border border-base-300"
      style={{
        top: `${position.top + 24}px`,
        left: position.left,
      }}
    >
      {searchResults.map((result, index) => (
        <div
          key={result.pubKey}
          role="option"
          aria-selected={index === selectedIndex}
          onMouseDown={(event) => event.preventDefault()}
          className={`p-2 hover:bg-neutral cursor-pointer ${
            index === selectedIndex ? "bg-neutral" : ""
          }`}
          onClick={() => onSelect(result)}
        >
          <UserRow
            pubKey={result.pubKey}
            linkToProfile={false}
            avatarWidth={24}
            fallbackProfile={result}
          />
        </div>
      ))}
    </div>
  )
}
