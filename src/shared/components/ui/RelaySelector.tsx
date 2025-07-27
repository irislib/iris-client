import {useState} from "react"
import {DEFAULT_RELAYS} from "@/utils/applesauce"

interface RelaySelectorProps {
  selectedRelay?: string
  onRelaySelect: (relay: string) => void
  placeholder?: string
  className?: string
  showCustomInput?: boolean
}

const RelaySelector = ({
  selectedRelay = "",
  onRelaySelect,
  placeholder = "Select a relay",
  className = "select select-bordered flex-1",
  showCustomInput = true,
}: RelaySelectorProps) => {
  const [customRelay, setCustomRelay] = useState<string>("")
  const [showCustomInputField, setShowCustomInputField] = useState(false)

  // Simple relay URL normalization
  const normalizeRelay = (url: string) =>
    url.replace(/^(https?:\/\/)?(wss?:\/\/)?/, "").replace(/\/$/, "")

  const relayOptions = [
    ...DEFAULT_RELAYS,
    ...(selectedRelay && !DEFAULT_RELAYS.includes(selectedRelay) ? [selectedRelay] : []),
  ]

  const handleAddCustomRelay = () => {
    if (customRelay.trim()) {
      const newRelay = customRelay.startsWith("wss://")
        ? customRelay
        : `wss://${customRelay}`
      onRelaySelect(newRelay)
      setCustomRelay("")
      setShowCustomInputField(false)
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2">
        <select
          className={className}
          value={selectedRelay}
          onChange={(e) => {
            const newRelay = e.target.value
            if (newRelay === "custom") {
              if (showCustomInput) {
                setShowCustomInputField(true)
              }
            } else {
              onRelaySelect(newRelay)
            }
          }}
        >
          <option value="">{placeholder}</option>
          {relayOptions.map((relay) => (
            <option key={relay} value={relay}>
              {normalizeRelay(relay)}
            </option>
          ))}
          {showCustomInput && <option value="custom">Add custom relay...</option>}
        </select>
      </div>

      {showCustomInputField && (
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="wss://relay.example.com"
            value={customRelay}
            onChange={(e) => setCustomRelay(e.target.value)}
            className="input input-bordered flex-1"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                handleAddCustomRelay()
              }
            }}
          />
          <button onClick={handleAddCustomRelay} className="btn btn-primary btn-sm">
            Add
          </button>
          <button
            onClick={() => {
              setShowCustomInputField(false)
              setCustomRelay("")
            }}
            className="btn btn-neutral btn-sm"
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  )
}

export default RelaySelector
