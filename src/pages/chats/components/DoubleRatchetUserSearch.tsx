import {useState, useEffect, type KeyboardEvent, type FormEvent} from "react"
import {UserRow} from "@/shared/components/user/UserRow"
import {useDoubleRatchetUsers} from "../hooks/useDoubleRatchetUsers"
import {DoubleRatchetUser} from "../utils/doubleRatchetUsers"

interface DoubleRatchetUserSearchProps {
  placeholder?: string
  onUserSelect: (user: DoubleRatchetUser) => void
  onRawInputSubmit?: (input: string) => boolean | Promise<boolean>
  maxResults?: number
  showCount?: boolean
  className?: string
}

// Helper function to get displayable name from user profile
const getUserDisplayName = (user: DoubleRatchetUser): string => {
  const {profile} = user
  return (
    (typeof profile.display_name === "string" ? profile.display_name : null) ||
    (typeof profile.name === "string" ? profile.name : null) ||
    (typeof profile.username === "string" ? profile.username : null) ||
    (typeof profile.nip05 === "string" ? profile.nip05.split("@")[0] : null) ||
    "Unknown User"
  )
}

export const DoubleRatchetUserSearch = ({
  placeholder = "Search for users",
  onUserSelect,
  onRawInputSubmit,
  maxResults = 10,
  showCount = true,
  className = "",
}: DoubleRatchetUserSearchProps) => {
  const [searchInput, setSearchInput] = useState("")
  const [searchResults, setSearchResults] = useState<DoubleRatchetUser[]>([])
  const {count, search} = useDoubleRatchetUsers()

  const handleSearchChange = (value: string) => {
    setSearchInput(value)
    if (!value.trim()) {
      setSearchResults([])
      return
    }
    const results = search(value)
    setSearchResults(results.slice(0, maxResults))
  }

  // Re-run search when data changes (count changes) and there's already a search query
  useEffect(() => {
    if (searchInput.trim()) {
      const results = search(searchInput)
      setSearchResults(results.slice(0, maxResults))
    }
  }, [count, search, searchInput, maxResults])

  const submitRawInput = (rawInput: string) => {
    if (!onRawInputSubmit) return

    const raw = rawInput.trim()
    if (!raw) return

    void Promise.resolve(onRawInputSubmit(raw)).then((handled) => {
      if (handled) {
        setSearchInput("")
        setSearchResults([])
      }
    })
  }

  const handleInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") return

    event.preventDefault()
    submitRawInput(searchInput)
  }

  const handleInput = (event: FormEvent<HTMLInputElement>) => {
    const value = event.currentTarget.value
    handleSearchChange(value)

    const nativeEvent = event.nativeEvent as Event & {inputType?: string}
    if (nativeEvent.inputType === "insertFromPaste") {
      submitRawInput(value)
    }
  }

  return (
    <div className={`flex flex-col gap-4 ${className}`}>
      <div>
        <input
          type="text"
          className="input input-bordered w-full"
          placeholder={placeholder}
          value={searchInput}
          onInput={handleInput}
          onKeyDown={handleInputKeyDown}
        />
        {showCount && (
          <p className="text-sm text-base-content/70 mt-2">
            {count} followed or messaged users have enabled secure messaging
          </p>
        )}
      </div>
      {searchResults.length > 0 && (
        <div className="flex flex-col gap-2">
          {searchResults.map((user) => {
            const displayName = getUserDisplayName(user)
            return (
              <button
                key={user.pubkey}
                className="btn btn-ghost justify-start text-left"
                aria-label={displayName}
                onClick={() => onUserSelect(user)}
              >
                <UserRow pubKey={user.pubkey} linkToProfile={false} />
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
