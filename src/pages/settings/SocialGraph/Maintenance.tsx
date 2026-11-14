import {SettingsGroup} from "@/shared/components/settings/SettingsGroup"
import {SettingsGroupItem} from "@/shared/components/settings/SettingsGroupItem"
import {SettingsButton} from "@/shared/components/settings/SettingsButton"
import {SettingsInputItem} from "@/shared/components/settings/SettingsInputItem"
import {
  useSocialGraph,
  getFollowLists,
  stopRecrawl,
  DEFAULT_CRAWL_DEGREE,
} from "@/utils/socialGraph"
import {useSocialGraphStore} from "@/stores/socialGraph"
import {createDebugLogger} from "@/utils/createDebugLogger"
import {DEBUG_NAMESPACES} from "@/utils/constants"
import {useState} from "react"

const {log} = createDebugLogger(DEBUG_NAMESPACES.UTILS)

export function Maintenance() {
  const socialGraph = useSocialGraph()
  const crawling = useSocialGraphStore((state) => state.isRecrawling)
  const [followDegree, setFollowDegree] = useState(String(DEFAULT_CRAWL_DEGREE))

  const handleRecalculateDistances = async () => {
    await socialGraph.recalculateFollowDistances()
    const removed = await socialGraph.removeMutedNotFollowedUsers()
    useSocialGraphStore.getState().incrementVersion()
    log("Removed", removed, "muted not followed users")
  }
  return (
    <SettingsGroup title="Maintenance">
      <SettingsGroupItem>
        <div className="flex flex-col space-y-1">
          <button onClick={handleRecalculateDistances} className="text-info text-left">
            Recalculate Follow Distances
          </button>
          <span className="text-xs text-base-content/60">Fast, no bandwidth usage</span>
        </div>
      </SettingsGroupItem>

      <SettingsInputItem
        label="Recrawl degree"
        value={followDegree}
        type="text"
        onChange={(val) => {
          const num = parseInt(val, 10)
          if (!isNaN(num) && num >= 1 && num <= 5) {
            setFollowDegree(val)
          } else if (val === "") {
            setFollowDegree("")
          }
        }}
        description="1-5, higher = more users crawled"
      />

      <SettingsGroupItem isLast={!crawling}>
        <div className="flex flex-col space-y-1">
          <button
            onClick={() => {
              const degree = parseInt(followDegree, 10) || DEFAULT_CRAWL_DEGREE
              getFollowLists(socialGraph.getRoot(), false, degree)
            }}
            className="text-info text-left"
            disabled={crawling}
          >
            {crawling ? "Recrawling..." : "Recrawl follow lists"}
          </button>
          <span className="text-xs text-base-content/60">Slow, bandwidth intensive</span>
        </div>
      </SettingsGroupItem>

      {crawling && (
        <SettingsButton
          label="Stop crawling"
          onClick={stopRecrawl}
          variant="destructive"
          isLast
        />
      )}
    </SettingsGroup>
  )
}
