import {useState, useRef, useEffect} from "react"
import {RiAddLine, RiCloseLine} from "@remixicon/react"
import {search, SearchResult} from "@/utils/profileSearch"
import {UserRow} from "@/shared/components/user/UserRow"
import {nip19} from "nostr-tools"

interface MultiUserSelectorProps {
  selectedPubkeys?: string[]
  onPubkeysChange: (pubkeys: string[]) => void
  placeholder?: string
  className?: string
  label?: string
}

const MultiUserSelector = ({
  selectedPubkeys = [],
  onPubkeysChange,
  placeholder = "Select users",
  className = "",
  label,
}: MultiUserSelectorProps) => {
  const [isOpen, setIsOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState("")
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [showAddInput, setShowAddInput] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false)
        setShowAddInput(false)
        setSearchQuery("")
      }
    }

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside)
      return () => document.removeEventListener("mousedown", handleClickOutside)
    }
  }, [isOpen])

  useEffect(() => {
    if (searchQuery.trim()) {
      search(searchQuery).then((results) => {
        setSearchResults(results.slice(0, 10).map((result) => result.item))
      })
    } else {
      setSearchResults([])
    }
  }, [searchQuery])

  useEffect(() => {
    if (showAddInput && inputRef.current) {
      inputRef.current.focus()
    }
  }, [showAddInput])

  const toggleUser = (pubkey: string) => {
    if (selectedPubkeys.includes(pubkey)) {
      onPubkeysChange(selectedPubkeys.filter((p) => p !== pubkey))
    } else {
      onPubkeysChange([...selectedPubkeys, pubkey])
    }
  }

  const handleAddUser = (pubkey: string) => {
    if (!selectedPubkeys.includes(pubkey)) {
      onPubkeysChange([...selectedPubkeys, pubkey])
    }
    setSearchQuery("")
    setShowAddInput(false)
  }

  const handleManualInput = () => {
    const input = searchQuery.trim()
    if (!input) return

    let pubkey = input
    // Try to decode if it's an npub
    if (input.startsWith("npub1")) {
      try {
        const decoded = nip19.decode(input)
        if (decoded.type === "npub") {
          pubkey = decoded.data
        }
      } catch (e) {
        // Invalid npub, use as-is
        console.error("Invalid npub:", e)
        return
      }
    }

    // Validate hex pubkey (64 chars)
    if (pubkey.length === 64 && /^[0-9a-f]+$/i.test(pubkey)) {
      handleAddUser(pubkey)
    }
  }

  let displayText = placeholder
  if (selectedPubkeys.length === 1) {
    displayText = "1 user selected"
  } else if (selectedPubkeys.length > 1) {
    displayText = `${selectedPubkeys.length} users selected`
  }

  return (
    <div ref={dropdownRef} className={`relative ${className}`}>
      {label && <span className="text-sm text-base-content/70 mb-1 block">{label}</span>}

      {/* Main button */}
      <button
        type="button"
        onClick={() => {
          setIsOpen(!isOpen)
          setShowAddInput(true)
        }}
        className="btn btn-sm btn-neutral w-full justify-between normal-case font-normal"
      >
        <span className="truncate">{displayText}</span>
        <svg
          className={`w-4 h-4 transition-transform ${isOpen ? "rotate-180" : ""}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M19 9l-7 7-7-7"
          />
        </svg>
      </button>

      {/* Dropdown menu */}
      {isOpen && (
        <div className="absolute z-50 mt-1 w-full bg-base-200 rounded-lg shadow-lg border border-base-300">
          <div className="max-h-96 overflow-y-auto">
            {/* Search input */}
            <div className="p-2 border-b border-base-300">
              {showAddInput && (
                <div className="flex gap-1">
                  <input
                    ref={inputRef}
                    type="text"
                    placeholder="Search or paste npub/hex..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="input input-xs flex-1"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        if (searchResults.length > 0) {
                          handleAddUser(searchResults[0].pubKey)
                        } else {
                          handleManualInput()
                        }
                      } else if (e.key === "Escape") {
                        setShowAddInput(false)
                        setSearchQuery("")
                      }
                    }}
                  />
                  <button
                    onClick={() => {
                      setShowAddInput(false)
                      setSearchQuery("")
                    }}
                    className="btn btn-xs btn-ghost"
                  >
                    <RiCloseLine className="w-3 h-3" />
                  </button>
                </div>
              )}
            </div>

            {/* Search results */}
            {searchQuery && searchResults.length > 0 && (
              <div className="p-2">
                <div className="text-xs font-semibold text-base-content/50 px-2 pb-1">
                  Search Results
                </div>
                {searchResults.map((result) => (
                  <div
                    key={result.pubKey}
                    onClick={() => handleAddUser(result.pubKey)}
                    className="cursor-pointer hover:bg-base-300 rounded p-1"
                  >
                    <UserRow
                      pubKey={result.pubKey}
                      linkToProfile={false}
                      fallbackProfile={result}
                    />
                  </div>
                ))}
              </div>
            )}

            {/* Selected users */}
            {selectedPubkeys.length > 0 && (
              <div className="p-2">
                <div className="text-xs font-semibold text-base-content/50 px-2 pb-1">
                  Selected Users
                </div>
                {selectedPubkeys.map((pubkey) => (
                  <div
                    key={pubkey}
                    className="flex items-center gap-2 hover:bg-base-300 rounded p-1"
                  >
                    <div className="flex-1">
                      <UserRow pubKey={pubkey} linkToProfile={false} />
                    </div>
                    <button
                      onClick={() => toggleUser(pubkey)}
                      className="btn btn-xs btn-ghost"
                      title="Remove"
                    >
                      <RiCloseLine className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Add button if no search showing */}
            {!showAddInput && (
              <div className="border-t border-base-300 p-2">
                <button
                  onClick={() => setShowAddInput(true)}
                  className="btn btn-xs btn-ghost w-full justify-start gap-1"
                >
                  <RiAddLine className="w-3 h-3" />
                  Add user
                </button>
              </div>
            )}

            {/* Clear all button */}
            {selectedPubkeys.length > 0 && (
              <div className="border-t border-base-300 p-2">
                <button
                  onClick={() => {
                    onPubkeysChange([])
                    setSearchQuery("")
                  }}
                  className="btn btn-xs btn-ghost w-full"
                >
                  Clear all
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default MultiUserSelector
