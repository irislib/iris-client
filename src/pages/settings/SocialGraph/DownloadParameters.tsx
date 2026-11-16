import {useState} from "react"
import {SettingsGroup} from "@/shared/components/settings/SettingsGroup"
import {SettingsGroupItem} from "@/shared/components/settings/SettingsGroupItem"
import {formatSize} from "@/shared/utils/formatSize"
import {
  prepareGraphDownloads,
  saveSizedLocalGraph,
  type GraphImportMode,
} from "@/utils/socialGraph"
import type {DiscoveryLimits} from "@/utils/discoverySnapshot"

type Field = keyof DiscoveryLimits
const limits: {field: Field; label: string}[] = [
  {field: "maxBytes", label: "Import size (KiB)"},
  {field: "maxNodes", label: "Max nodes"},
  {field: "maxEdges", label: "Max edges"},
  {field: "maxDistance", label: "Max distance"},
  {field: "maxEdgesPerNode", label: "Max edges per node"},
]

export function DownloadParameters() {
  const [values, setValues] = useState<Partial<Record<Field, string>>>({
    maxNodes: "30000",
  })
  const [local, setLocal] = useState(false)
  const [mode, setMode] = useState<GraphImportMode>("merge")
  const [source, setSource] =
    useState<Awaited<ReturnType<typeof prepareGraphDownloads>>>()
  const [busy, setBusy] = useState<"preview" | "mobile" | "full">()
  const [result, setResult] = useState("")
  const [error, setError] = useState("")
  async function act(action: "preview" | "mobile" | "full", fn: () => Promise<void>) {
    setBusy(action)
    setResult("")
    setError("")
    try {
      await fn()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Download failed")
    } finally {
      setBusy(undefined)
    }
  }
  async function importGraph() {
    if (!local && !source) return
    const chosen: DiscoveryLimits = {}
    for (const {field, label} of limits) {
      const value = values[field]
      if (!value) continue
      const n = Number(value)
      if (
        !Number.isSafeInteger(n) ||
        n < 1 ||
        (field === "maxBytes" && !Number.isSafeInteger(n * 1024))
      ) {
        throw new Error(`${label} must be a positive whole number`)
      }
      chosen[field] = field === "maxBytes" ? n * 1024 : n
    }
    const bytes = local
      ? await saveSizedLocalGraph(chosen)
      : await source!.importMobile(chosen, mode)
    setResult(`${local || mode === "save" ? "Saved" : "Imported"} ${formatSize(bytes)}`)
  }
  return (
    <SettingsGroup title="Download Snapshot">
      <SettingsGroupItem>
        <label className="flex justify-between items-center">
          Source
          <select
            aria-label="Snapshot source"
            value={local ? "local" : "discovery"}
            disabled={Boolean(busy)}
            onChange={(event) => {
              setLocal(event.target.value === "local")
              setResult("")
              setError("")
            }}
            className="select select-sm select-ghost"
          >
            <option value="discovery">Iris discovery snapshot</option>
            <option value="local">My current graph</option>
          </select>
        </label>
        <p className="text-sm text-base-content/70">
          {local
            ? "Save a copy of your graph using these limits. No download is needed."
            : "The signed discovery snapshot covers up to 30,000 users. The entire snapshot downloads. These limits apply to the file you save or import."}
        </p>
      </SettingsGroupItem>
      {limits.map(({field, label}) => (
        <SettingsGroupItem key={field}>
          <label className="flex items-center justify-between">
            {label}
            <input
              type="number"
              min="1"
              step="1"
              placeholder="All"
              value={values[field] ?? ""}
              onChange={(e) => setValues({...values, [field]: e.target.value})}
              className="bg-transparent border-none p-0 text-base focus:outline-none text-right w-20"
            />
          </label>
        </SettingsGroupItem>
      ))}
      {!local && (
        <SettingsGroupItem>
          <label className="flex justify-between items-center">
            Import mode
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value as GraphImportMode)}
              className="select select-sm select-ghost"
            >
              <option value="merge">Merge into my graph</option>
              <option value="replace">Replace my graph</option>
              <option value="save">Save to file</option>
            </select>
          </label>
        </SettingsGroupItem>
      )}
      <SettingsGroupItem isLast>
        <div className="flex flex-col items-start gap-2">
          {local ? (
            <button
              disabled={Boolean(busy)}
              onClick={() => act("mobile", importGraph)}
              className="text-info"
            >
              {busy ? "Saving…" : "Save my graph"}
            </button>
          ) : !source ? (
            <button
              disabled={Boolean(busy)}
              onClick={() =>
                act("preview", async () => setSource(await prepareGraphDownloads()))
              }
              className="text-info"
            >
              {busy ? "Checking…" : "Check download sizes"}
            </button>
          ) : (
            <>
              {source.mobileBytes !== undefined ? (
                <button
                  disabled={Boolean(busy)}
                  onClick={() => act("mobile", importGraph)}
                  className="text-info"
                >
                  {busy === "mobile"
                    ? "Downloading…"
                    : `Download graph (${formatSize(source.mobileBytes)})`}
                </button>
              ) : (
                <span className="text-sm">
                  The current snapshot has no Iris discovery graph.
                </span>
              )}
              <button
                disabled={Boolean(busy)}
                onClick={() => act("full", source.saveFull)}
                className="text-info"
              >
                {busy === "full"
                  ? "Saving…"
                  : `Save full snapshot (${formatSize(source.fullBytes)})`}
              </button>
            </>
          )}
          {result && (
            <span role="status" className="text-xs text-success">
              {result}
            </span>
          )}
          {error && (
            <span role="alert" className="text-xs text-error">
              {error}
            </span>
          )}
        </div>
      </SettingsGroupItem>
    </SettingsGroup>
  )
}
