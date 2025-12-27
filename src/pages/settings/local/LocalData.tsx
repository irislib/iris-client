/* eslint-disable @typescript-eslint/no-explicit-any */
import {SettingsGroup} from "@/shared/components/settings/SettingsGroup"
import {SettingsGroupItem} from "@/shared/components/settings/SettingsGroupItem"
import {SettingsButton} from "@/shared/components/settings/SettingsButton"
import {useState, useEffect, MouseEvent} from "react"
import {confirm} from "@/utils/utils"
import Dexie from "dexie"
import {createDebugLogger} from "@/utils/createDebugLogger"
import {DEBUG_NAMESPACES} from "@/utils/constants"
import {getTauriTransport, getWorkerTransport} from "@/utils/ndk"

const {log, warn, error} = createDebugLogger(DEBUG_NAMESPACES.UTILS)

interface IDBDatabaseInfo {
  name: string
  size?: string
}

interface EventStats {
  totalEvents: number
  eventsByKind: Record<number, number>
  databaseSize?: string
  oldestEvent?: number
  newestEvent?: number
}

export function LocalData() {
  const [stats, setStats] = useState<EventStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [isClearing, setIsClearing] = useState(false)
  const [idbDatabases, setIdbDatabases] = useState<IDBDatabaseInfo[]>([])
  const [showAllDatabases, setShowAllDatabases] = useState(false)

  const loadStats = async () => {
    try {
      setLoading(true)
      setErrorMessage(null)

      // Get stats from transport (worker or tauri backend)
      const transport = getTauriTransport() || getWorkerTransport()

      if (!transport?.getStats) {
        throw new Error("No transport with getStats available")
      }

      const stats = await transport.getStats()

      // Sort kinds by count
      const sortedKinds = Object.entries(stats.eventsByKind)
        .sort(([, a], [, b]) => b - a)
        .reduce(
          (acc, [kind, count]) => {
            acc[parseInt(kind)] = count
            return acc
          },
          {} as Record<number, number>
        )

      // Total storage estimate
      let dbSize: string | undefined
      if ("estimate" in navigator.storage) {
        const estimate = await navigator.storage.estimate()
        if (estimate.usage) {
          dbSize = formatBytes(estimate.usage)
        }
      }

      setStats({
        totalEvents: stats.totalEvents,
        eventsByKind: sortedKinds,
        databaseSize: dbSize,
        oldestEvent: undefined,
        newestEvent: undefined,
      })
    } catch (caughtError) {
      error("Error loading Nostr stats:", caughtError)
      setErrorMessage(
        caughtError instanceof Error ? caughtError.message : "Failed to load stats"
      )
    } finally {
      setLoading(false)
    }
  }

  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return "0 Bytes"
    const k = 1024
    const sizes = ["Bytes", "KB", "MB", "GB"]
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + " " + sizes[i]
  }

  const formatDate = (timestamp: number): string => {
    return new Date(timestamp * 1000).toLocaleString()
  }

  const getKindName = (kind: number): string => {
    const kindNames: Record<number, string> = {
      0: "Metadata",
      1: "Text note",
      3: "Contacts",
      4: "Encrypted DM",
      5: "Event deletion",
      6: "Repost",
      7: "Reaction",
      9: "Group chat message",
      10: "Group chat thread reply",
      11: "Group thread",
      12: "Group thread reply",
      40: "Channel creation",
      41: "Channel metadata",
      42: "Channel message",
      43: "Channel hide message",
      44: "Channel mute user",
      1063: "File metadata",
      1984: "Report",
      9734: "Zap request",
      9735: "Zap",
      10000: "Mute list",
      10001: "Pin list",
      10002: "Relay list",
      10003: "Bookmark list",
      10004: "Communities",
      10005: "Public chats",
      10006: "Blocked relays",
      10007: "Search relays",
      10009: "User groups",
      10015: "Interests",
      10030: "User emoji list",
      30000: "Categorized people",
      30001: "Categorized bookmarks",
      30008: "Profile badges",
      30009: "Badge definition",
      30017: "Create/update stall",
      30018: "Create/update product",
      30023: "Long-form content",
      30078: "Application-specific data",
      30311: "Live event",
      30315: "User status",
      31989: "Handler recommendation",
      31990: "Handler information",
    }
    return kindNames[kind] || `Kind ${kind}`
  }

  const loadAllDatabases = async () => {
    try {
      if (!("databases" in indexedDB)) {
        warn("indexedDB.databases() not supported")
        return
      }

      const databases = await indexedDB.databases()
      const dbInfos: IDBDatabaseInfo[] = []

      // Get storage estimate with per-database breakdown
      let usageDetails: any = null
      if ("estimate" in navigator.storage) {
        const estimate = await navigator.storage.estimate()
        usageDetails = (estimate as any).usageDetails
      }

      for (const dbInfo of databases) {
        if (!dbInfo.name) continue

        let sizeStr: string | undefined

        // Try to get actual size from usageDetails
        if (usageDetails?.indexedDB) {
          // Some browsers provide per-database breakdown
          const dbSize = (usageDetails as any)[dbInfo.name]
          if (dbSize) {
            sizeStr = formatBytes(dbSize)
          }
        }

        // Fallback: estimate by counting records
        if (!sizeStr) {
          try {
            const db = new Dexie(dbInfo.name)
            await db.open()
            const tableNames = db.tables.map((t: any) => t.name)

            let totalCount = 0
            for (const tableName of tableNames) {
              try {
                const count = await db.table(tableName).count()
                totalCount += count
              } catch {
                // Skip tables we can't access
              }
            }

            db.close()

            if (totalCount > 0) {
              sizeStr = `~${totalCount} records`
            }
          } catch (e) {
            // Can't open/read this database
          }
        }

        dbInfos.push({
          name: dbInfo.name,
          size: sizeStr,
        })
      }

      setIdbDatabases(dbInfos)
    } catch (caughtError) {
      error("Error loading databases:", caughtError)
    }
  }

  useEffect(() => {
    loadStats()
    loadAllDatabases()

    // Refresh stats every 30 seconds
    const interval = setInterval(() => {
      loadStats()
      loadAllDatabases()
    }, 30000)

    return () => clearInterval(interval)
  }, [])

  const handleClearAll = async (e?: MouseEvent) => {
    e?.preventDefault()
    e?.stopPropagation()

    const confirmed = await confirm(
      "Delete all local Nostr data? Events will be re-downloaded as needed. Page will reload.",
      "Clear all local data?"
    )

    if (!confirmed) return

    setIsClearing(true)

    try {
      // Clear all IndexedDB databases
      if ("databases" in indexedDB) {
        const databases = await indexedDB.databases()
        await Promise.all(
          databases.map(async (dbInfo) => {
            if (dbInfo.name) {
              const db = new Dexie(dbInfo.name)
              await db.delete()
              log(`Deleted database: ${dbInfo.name}`)
            }
          })
        )
      } else {
        // Fallback: just delete the main one
        const db = new Dexie("treelike-nostr")
        await db.delete()
        const db2 = new Dexie("irisdb-nostr")
        await db2.delete()
        log("Cleared Dexie database")
      }

      // Clear OPFS completely
      if (navigator.storage?.getDirectory) {
        try {
          const root = await navigator.storage.getDirectory()

          // Remove all entries in OPFS root
          for await (const [name] of (root as any).entries()) {
            try {
              await root.removeEntry(name, {recursive: true})
              log(`Removed OPFS entry: ${name}`)
            } catch (e) {
              warn(`Failed to remove OPFS entry ${name}:`, e)
            }
          }
        } catch (opfsErr) {
          warn("Could not clear OPFS:", opfsErr)
        }
      }

      // Wait for deletions to complete
      await new Promise((resolve) => setTimeout(resolve, 500))

      // Reload to ensure clean state
      window.location.reload()
    } catch (caughtError) {
      error("Error clearing all data:", caughtError)
      setErrorMessage(
        caughtError instanceof Error ? caughtError.message : "Failed to clear all data"
      )
      setIsClearing(false)
    }
  }

  const topKinds = stats ? Object.entries(stats.eventsByKind).slice(0, 10) : []

  return (
    <div className="flex flex-col gap-4 p-4">
      {loading && (
        <div className="text-center text-base-content/70 text-sm">
          Loading statistics...
        </div>
      )}

      {errorMessage && (
        <div className="text-center text-error text-sm">
          Error loading statistics: {errorMessage}
        </div>
      )}

      {!loading && !errorMessage && !stats && (
        <div className="text-center text-base-content/70 text-sm">No data available</div>
      )}
      {stats && (
        <>
          <SettingsGroup title="Overview">
            <SettingsGroupItem>
              <div className="flex justify-between items-center">
                <span>Total events</span>
                <span className="text-base-content/70">
                  {stats.totalEvents.toLocaleString()}
                </span>
              </div>
            </SettingsGroupItem>

            {stats.databaseSize && (
              <SettingsGroupItem>
                <div className="flex justify-between items-center">
                  <span>Storage used</span>
                  <span className="text-base-content/70">{stats.databaseSize}</span>
                </div>
              </SettingsGroupItem>
            )}

            {stats.oldestEvent && (
              <SettingsGroupItem>
                <div className="flex justify-between items-center">
                  <span>Oldest event</span>
                  <span className="text-base-content/70 text-sm">
                    {formatDate(stats.oldestEvent)}
                  </span>
                </div>
              </SettingsGroupItem>
            )}

            {stats.newestEvent && (
              <SettingsGroupItem isLast>
                <div className="flex justify-between items-center">
                  <span>Newest event</span>
                  <span className="text-base-content/70 text-sm">
                    {formatDate(stats.newestEvent)}
                  </span>
                </div>
              </SettingsGroupItem>
            )}
          </SettingsGroup>

          <SettingsGroup title="Top Event Kinds">
            {topKinds.map(([kind, count], index) => (
              <SettingsGroupItem key={kind} isLast={index === topKinds.length - 1}>
                <div className="flex justify-between items-center">
                  <div className="flex flex-col">
                    <span>{getKindName(parseInt(kind))}</span>
                    <span className="text-xs text-base-content/50">Kind {kind}</span>
                  </div>
                  <span className="text-base-content/70">{count.toLocaleString()}</span>
                </div>
              </SettingsGroupItem>
            ))}
          </SettingsGroup>

          {Object.keys(stats.eventsByKind).length > 10 && (
            <div className="text-sm text-base-content/50 text-center">
              Showing top 10 of {Object.keys(stats.eventsByKind).length} event kinds
            </div>
          )}
        </>
      )}

      {idbDatabases.length > 0 && (
        <SettingsGroup title="All IndexedDB Databases">
          <SettingsGroupItem>
            <button
              className="w-full text-left text-sm text-base-content/70"
              onClick={() => setShowAllDatabases(!showAllDatabases)}
            >
              {showAllDatabases ? "▼" : "▶"} {idbDatabases.length} database
              {idbDatabases.length !== 1 ? "s" : ""} found
            </button>
          </SettingsGroupItem>

          {showAllDatabases &&
            idbDatabases.map((db, index) => (
              <SettingsGroupItem key={db.name} isLast={index === idbDatabases.length - 1}>
                <div className="flex justify-between items-center">
                  <span className="font-mono text-sm">{db.name}</span>
                  {db.size && (
                    <span className="text-base-content/70 text-sm">{db.size}</span>
                  )}
                </div>
              </SettingsGroupItem>
            ))}
        </SettingsGroup>
      )}

      <SettingsGroup title="Danger Zone">
        <SettingsGroupItem>
          <div className="text-sm text-base-content/70">
            Clear ALL local Nostr data (IndexedDB + OPFS). Events will be re-downloaded
            from relays as needed. This action cannot be undone.
          </div>
        </SettingsGroupItem>

        <SettingsButton
          label={isClearing ? "Clearing..." : "Clear all local data"}
          onClick={handleClearAll}
          variant="destructive"
          isLast
          disabled={isClearing}
        />
      </SettingsGroup>
    </div>
  )
}

export default LocalData
