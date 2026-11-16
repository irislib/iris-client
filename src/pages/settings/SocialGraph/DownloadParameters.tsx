import {SettingsGroup} from "@/shared/components/settings/SettingsGroup"
import {SettingsGroupItem} from "@/shared/components/settings/SettingsGroupItem"
import {formatSize} from "@/shared/utils/formatSize"

interface DownloadParametersProps {
  maxNodes: number
  setMaxNodes: (value: number) => void
  maxEdges: number | undefined
  setMaxEdges: (value: number | undefined) => void
  maxDistance: number | undefined
  setMaxDistance: (value: number | undefined) => void
  maxEdgesPerNode: number | undefined
  setMaxEdgesPerNode: (value: number | undefined) => void
  isDownloading: boolean
  downloadedBytes: number | null
  downloadError: string | null
  replace: boolean
  setReplace: (value: boolean) => void
  fullBytes?: number
  loadingFull: boolean
  onFullDownload: () => void
  onDownload: () => void
}

export function DownloadParameters({
  maxNodes,
  setMaxNodes,
  maxEdges,
  setMaxEdges,
  maxDistance,
  setMaxDistance,
  maxEdgesPerNode,
  setMaxEdgesPerNode,
  isDownloading,
  downloadedBytes,
  downloadError,
  replace,
  setReplace,
  fullBytes,
  loadingFull,
  onFullDownload,
  onDownload,
}: DownloadParametersProps) {
  return (
    <SettingsGroup title="Download Snapshot">
      <SettingsGroupItem>
        <p className="text-sm text-base-content/70">
          Import a Hashtree discovery snapshot of up to 30,000 users, 180,000
          relationships and four follow hops. Use the limits below to import less.
        </p>
      </SettingsGroupItem>
      <SettingsGroupItem>
        <div className="flex justify-between items-center">
          <span>Max nodes</span>
          <input
            type="number"
            min="1"
            value={maxNodes}
            onChange={(e) => setMaxNodes(Number(e.target.value))}
            className="bg-transparent border-none p-0 text-base focus:outline-none text-right w-20"
          />
        </div>
      </SettingsGroupItem>

      <SettingsGroupItem>
        <div className="flex justify-between items-center">
          <span>Max edges</span>
          <input
            type="number"
            min="1"
            value={maxEdges ?? ""}
            onChange={(e) =>
              setMaxEdges(e.target.value ? Number(e.target.value) : undefined)
            }
            className="bg-transparent border-none p-0 text-base focus:outline-none text-right w-20"
            placeholder="All"
          />
        </div>
      </SettingsGroupItem>

      <SettingsGroupItem>
        <div className="flex justify-between items-center">
          <span>Max distance</span>
          <input
            type="number"
            min="1"
            value={maxDistance ?? ""}
            onChange={(e) =>
              setMaxDistance(e.target.value ? Number(e.target.value) : undefined)
            }
            className="bg-transparent border-none p-0 text-base focus:outline-none text-right w-20"
            placeholder="All"
          />
        </div>
      </SettingsGroupItem>

      <SettingsGroupItem>
        <div className="flex justify-between items-center">
          <span>Max edges per node</span>
          <input
            type="number"
            min="1"
            value={maxEdgesPerNode ?? ""}
            onChange={(e) =>
              setMaxEdgesPerNode(e.target.value ? Number(e.target.value) : undefined)
            }
            className="bg-transparent border-none p-0 text-base focus:outline-none text-right w-20"
            placeholder="All"
          />
        </div>
      </SettingsGroupItem>

      <SettingsGroupItem>
        <label className="flex justify-between items-center">
          Import mode
          <select
            value={replace ? "replace" : "merge"}
            onChange={(event) => setReplace(event.target.value === "replace")}
            className="select select-sm select-ghost"
          >
            <option value="merge">Merge into my graph</option>
            <option value="replace">Replace my graph</option>
          </select>
        </label>
      </SettingsGroupItem>
      <SettingsGroupItem>
        <div className="flex flex-col space-y-1">
          <button
            onClick={onDownload}
            disabled={isDownloading || loadingFull}
            className="text-info text-left"
          >
            {isDownloading ? "Downloading..." : "Download graph"}
          </button>
          {downloadedBytes !== null && !isDownloading && !downloadError && (
            <span className="text-xs text-success">
              Imported {formatSize(downloadedBytes)}
            </span>
          )}
          {downloadError && (
            <span className="text-xs text-error">Error: {downloadError}</span>
          )}
        </div>
      </SettingsGroupItem>
      <SettingsGroupItem isLast>
        <button
          disabled={isDownloading || loadingFull}
          onClick={onFullDownload}
          className="text-info"
        >
          {loadingFull
            ? "Loading…"
            : fullBytes === undefined
              ? "Check full snapshot size"
              : `Save full snapshot (${formatSize(fullBytes)})`}
        </button>
      </SettingsGroupItem>
    </SettingsGroup>
  )
}
