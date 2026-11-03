import {useEffect, useState, ChangeEvent, KeyboardEvent} from "react"
import {RiDeleteBinLine, RiFileCopyLine} from "@remixicon/react"
import {type FeedConfig} from "@/stores/feed"
import MultiRelaySelector from "@/shared/components/ui/MultiRelaySelector"
import MultiUserSelector from "@/shared/components/ui/MultiUserSelector"
import EventKindsSelector from "@/shared/components/ui/EventKindsSelector"
import ResultViewToggle from "@/shared/components/search/ResultViewToggle"
import {GeohashField} from "./FeedEditor/GeohashField"
import {FollowDistanceField} from "./FeedEditor/FollowDistanceField"

interface FeedEditorProps {
  feedConfig: FeedConfig
  onConfigChange: (config: FeedConfig) => void
  onClose: () => void
  onDelete?: () => void
  onReset?: () => void
  onClone?: () => void
  showDeleteButton?: boolean
  showResetButton?: boolean
  showCloneButton?: boolean
}

function FeedEditor({
  feedConfig,
  onConfigChange,
  onClose,
  onDelete,
  onReset,
  onClone,
  showDeleteButton = true,
  showResetButton = true,
  showCloneButton = true,
}: FeedEditorProps) {
  const [editingName, setEditingName] = useState(feedConfig.customName || feedConfig.name)
  const [localConfig, setLocalConfig] = useState<FeedConfig>(feedConfig)

  // Helper function for common checkboxes
  const renderCommonCheckboxes = (
    updateConfig: (field: keyof FeedConfig, value: unknown) => void
  ) => {
    const showReplies = !(localConfig?.hideReplies ?? false)

    return (
      <>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={showReplies}
            onChange={(e) => {
              updateConfig("hideReplies", !e.target.checked)
              // If hiding replies, also hide replied-to posts
              if (!e.target.checked) {
                updateConfig("showRepliedTo", false)
              }
            }}
            className="checkbox checkbox-sm"
          />
          <span className="text-sm text-base-content/70">Show replies</span>
        </label>

        <label
          className={`flex items-center gap-2 cursor-pointer ml-6 ${
            !showReplies ? "opacity-50" : ""
          }`}
        >
          <input
            type="checkbox"
            checked={showReplies && (localConfig?.showRepliedTo ?? true)}
            onChange={(e) => updateConfig("showRepliedTo", e.target.checked)}
            className="checkbox checkbox-sm"
            disabled={!showReplies}
          />
          <span className="text-sm text-base-content/70">Show replied-to posts</span>
        </label>

        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={localConfig?.requiresMedia ?? false}
            onChange={(e) => updateConfig("requiresMedia", e.target.checked)}
            className="checkbox checkbox-sm"
          />
          <span className="text-sm text-base-content/70">Only show posts with media</span>
        </label>

        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={localConfig?.excludeSeen ?? false}
            onChange={(e) => updateConfig("excludeSeen", e.target.checked)}
            className="checkbox checkbox-sm"
          />
          <span className="text-sm text-base-content/70">Hide seen posts</span>
        </label>

        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={localConfig?.autoShowNewEvents ?? false}
            onChange={(e) => updateConfig("autoShowNewEvents", e.target.checked)}
            className="checkbox checkbox-sm"
          />
          <span className="text-sm text-base-content/70">
            Show new events automatically
          </span>
        </label>

        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={localConfig?.showZapAll ?? false}
            onChange={(e) => updateConfig("showZapAll", e.target.checked)}
            className="checkbox checkbox-sm"
          />
          <span className="text-sm text-base-content/70">
            Always show &quot;zap all&quot;
          </span>
        </label>
      </>
    )
  }

  // Update local config when feedConfig prop changes
  useEffect(() => {
    setLocalConfig(feedConfig)
    setEditingName(feedConfig.customName || feedConfig.name)
  }, [feedConfig])

  // Notify parent of config changes
  useEffect(() => {
    if (JSON.stringify(localConfig) !== JSON.stringify(feedConfig)) {
      const timer = setTimeout(() => {
        onConfigChange(localConfig)
      }, 500)
      return () => clearTimeout(timer)
    }
  }, [localConfig, feedConfig, onConfigChange])

  // Update local config immediately
  const updateLocalConfig = (field: keyof FeedConfig, value: unknown) => {
    setLocalConfig((prev) => {
      if (!prev) return prev
      return {...prev, [field]: value}
    })
  }

  const handleNameChange = (e: ChangeEvent<HTMLInputElement>) => {
    const newName = e.target.value
    setEditingName(newName)
    // Update local config instead of directly saving to store
    updateLocalConfig("customName", newName.trim() || undefined)
  }

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      setEditingName(feedConfig.customName || feedConfig.name)
    }
  }

  const updateConfig = updateLocalConfig

  return (
    <div className="flex flex-col gap-4 mt-4 p-4 border border-base-300 rounded-lg">
      <div className="flex justify-between items-center">
        <div className="text-lg font-semibold">
          Edit &quot;{localConfig.customName || localConfig.name}&quot;
        </div>
        {showCloneButton && onClone && (
          <button
            onClick={onClone}
            className="btn btn-sm btn-neutral"
            title="Clone this feed"
          >
            <RiFileCopyLine className="w-4 h-4" />
            Clone
          </button>
        )}
      </div>

      {/* Basic Settings */}
      <div className="flex items-center gap-2">
        <span className="text-sm text-base-content/70 min-w-[7rem]">Name</span>
        <input
          type="text"
          value={editingName}
          onChange={handleNameChange}
          onKeyDown={handleKeyDown}
          className="input input-sm flex-1 text-sm"
          placeholder={localConfig.name}
        />
      </div>

      {/* Follow Distance */}
      <FollowDistanceField
        value={localConfig.followDistance}
        onChange={(value) => updateConfig("followDistance", value)}
        showLabel={true}
      />

      {/* Filter Kinds */}
      <div className="flex items-start gap-2">
        <span className="text-sm text-base-content/70 min-w-[7rem] pt-2">
          Event Kinds
        </span>
        <div className="flex-1 overflow-hidden">
          <EventKindsSelector
            selectedKinds={localConfig.filter?.kinds || []}
            onKindsChange={(kinds) => {
              const currentFilter = localConfig.filter || {}
              if (kinds.length === 0) {
                // Remove kinds property if no kinds selected
                const filterWithoutKinds = Object.fromEntries(
                  Object.entries(currentFilter).filter(([key]) => key !== "kinds")
                )
                updateConfig(
                  "filter",
                  Object.keys(filterWithoutKinds).length > 0
                    ? filterWithoutKinds
                    : undefined
                )
              } else {
                updateConfig("filter", {...currentFilter, kinds})
              }
            }}
          />
          <span className="text-xs text-base-content/50 mt-1 block">
            Select event types to include in this feed. Select none to display all.
          </span>
        </div>
      </div>

      {/* Search Term */}
      <div className="flex items-start gap-2">
        <label
          htmlFor="feed-search"
          className="text-sm text-base-content/70 min-w-[7rem] pt-2"
        >
          Search
        </label>
        <div className="flex-1 min-w-0">
          <input
            id="feed-search"
            type="text"
            value={localConfig.filter?.search || ""}
            onChange={(e) => {
              const inputValue = e.target.value
              const currentFilter = localConfig.filter || {}
              if (!inputValue.trim()) {
                // Remove search property if input is empty
                const filterWithoutSearch = Object.fromEntries(
                  Object.entries(currentFilter).filter(([key]) => key !== "search")
                )
                updateConfig("filter", filterWithoutSearch)
              } else {
                updateConfig("filter", {...currentFilter, search: inputValue})
              }
            }}
            onBlur={() => {
              if (localConfig !== feedConfig) onConfigChange(localConfig)
            }}
            className="input input-sm w-full text-sm"
            placeholder={
              localConfig.aiSearch ? "Describe the posts you want" : "Search terms"
            }
          />
          <ResultViewToggle
            aiSelected={!!localConfig.aiSearch}
            onChange={(aiSearch) => onConfigChange({...localConfig, aiSearch})}
          />
        </div>
      </div>

      {/* Limit */}
      <div className="flex items-start gap-2">
        <span className="text-sm text-base-content/70 min-w-[7rem] pt-2">Limit</span>
        <div className="flex-1">
          <input
            type="number"
            min="10"
            max="1000"
            value={localConfig.filter?.limit || ""}
            onChange={(e) =>
              updateConfig("filter", {
                ...(localConfig.filter || {}),
                limit: e.target.value ? parseInt(e.target.value) : undefined,
              })
            }
            className="input input-sm w-24 text-sm"
            placeholder="100"
          />
          <span className="text-xs text-base-content/50 mt-1 block">
            Max events to initially fetch
          </span>
        </div>
      </div>

      {/* Relay Selection */}
      <div className="flex items-start gap-2">
        <span className="text-sm text-base-content/70 min-w-[7rem] pt-2">Relays</span>
        <div className="flex-1">
          <MultiRelaySelector
            selectedRelays={localConfig.relayUrls || []}
            onRelaysChange={(relays) => {
              updateConfig("relayUrls", relays.length > 0 ? relays : undefined)
            }}
            placeholder="Default relays"
          />
          <span className="text-xs text-base-content/50 mt-1 block">
            Leave empty to use default relays
          </span>
        </div>
      </div>

      {/* Geohash Filter */}
      <GeohashField
        value={localConfig.filter?.["#g"]}
        onChange={(geohashes) => {
          const currentFilter = localConfig.filter || {}
          if (geohashes === undefined) {
            // Remove #g property if no geohashes
            const filterWithoutGeohash = Object.fromEntries(
              Object.entries(currentFilter).filter(([key]) => key !== "#g")
            )
            updateConfig(
              "filter",
              Object.keys(filterWithoutGeohash).length > 0
                ? filterWithoutGeohash
                : undefined
            )
          } else {
            updateConfig("filter", {...currentFilter, "#g": geohashes})
          }
        }}
        showLabel={true}
      />

      {/* Authors Filter */}
      <div className="flex items-start gap-2">
        <span className="text-sm text-base-content/70 min-w-[7rem] pt-2">Authors</span>
        <div className="flex-1">
          <MultiUserSelector
            selectedPubkeys={localConfig.filter?.authors || []}
            onPubkeysChange={(pubkeys) => {
              const currentFilter = localConfig.filter || {}
              if (pubkeys.length === 0) {
                // Remove authors property if no pubkeys selected
                const filterWithoutAuthors = Object.fromEntries(
                  Object.entries(currentFilter).filter(([key]) => key !== "authors")
                )
                updateConfig(
                  "filter",
                  Object.keys(filterWithoutAuthors).length > 0
                    ? filterWithoutAuthors
                    : undefined
                )
              } else {
                updateConfig("filter", {...currentFilter, authors: pubkeys})
              }
            }}
            placeholder="All users"
          />
          <span className="text-xs text-base-content/50 mt-1 block">
            Filter by specific authors
          </span>
        </div>
      </div>

      {/* Mentioned Users Filter */}
      <div className="flex items-start gap-2">
        <span className="text-sm text-base-content/70 min-w-[7rem] pt-2">
          Mentioned Users
        </span>
        <div className="flex-1">
          <MultiUserSelector
            selectedPubkeys={localConfig.filter?.["#p"] || []}
            onPubkeysChange={(pubkeys) => {
              const currentFilter = localConfig.filter || {}
              if (pubkeys.length === 0) {
                // Remove #p property if no pubkeys selected
                const filterWithoutP = Object.fromEntries(
                  Object.entries(currentFilter).filter(([key]) => key !== "#p")
                )
                updateConfig(
                  "filter",
                  Object.keys(filterWithoutP).length > 0 ? filterWithoutP : undefined
                )
              } else {
                updateConfig("filter", {...currentFilter, "#p": pubkeys})
              }
            }}
            placeholder="All users"
          />
          <span className="text-xs text-base-content/50 mt-1 block">
            Filter by users mentioned/tagged in posts
          </span>
        </div>
      </div>

      {/* Checkboxes */}
      <div className="flex flex-col gap-2">{renderCommonCheckboxes(updateConfig)}</div>

      {/* Action Buttons */}
      <div className="flex justify-between gap-2 pt-2 border-t border-base-300">
        <button onClick={onClose} className="btn btn-sm btn-primary" title="Done editing">
          Done
        </button>
        <div className="flex flex-row gap-2">
          {showResetButton && onReset && (
            <button
              onClick={onReset}
              className="btn btn-sm btn-neutral"
              title="Reset feed"
            >
              Reset feeds
            </button>
          )}
          {showDeleteButton && onDelete && (
            <button
              onClick={onDelete}
              className="btn btn-sm btn-neutral"
              title="Delete feed"
            >
              <RiDeleteBinLine className="w-4 h-4" />
              Delete
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

export default FeedEditor
