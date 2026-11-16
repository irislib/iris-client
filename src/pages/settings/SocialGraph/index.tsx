import {importDiscoverySnapshot, prepareFullGraphDownload} from "@/utils/socialGraph"
import {useState} from "react"
import {Statistics} from "./Statistics"
import {FileOperations} from "./FileOperations"
import {Maintenance} from "./Maintenance"
import {DownloadParameters} from "./DownloadParameters"
import {TopUsers} from "./TopUsers"

function SocialGraphSettings() {
  const [maxNodes, setMaxNodes] = useState<number>(30000)
  const [maxEdges, setMaxEdges] = useState<number | undefined>(undefined)
  const [maxDistance, setMaxDistance] = useState<number | undefined>(undefined)
  const [maxEdgesPerNode, setMaxEdgesPerNode] = useState<number | undefined>(undefined)
  const [downloadedBytes, setDownloadedBytes] = useState<number | null>(null)
  const [isDownloading, setIsDownloading] = useState<boolean>(false)
  const [downloadError, setDownloadError] = useState<string | null>(null)
  const [replace, setReplace] = useState(false)
  const [full, setFull] = useState<Awaited<ReturnType<typeof prepareFullGraphDownload>>>()
  const [loadingFull, setLoadingFull] = useState(false)
  const handleFullDownload = async () => {
    setLoadingFull(true)
    setDownloadError(null)
    try {
      if (full) {
        await full.save()
        setFull(undefined)
      } else {
        setFull(await prepareFullGraphDownload())
      }
    } catch (error) {
      setFull(undefined)
      setDownloadError(error instanceof Error ? error.message : "Download failed")
    } finally {
      setLoadingFull(false)
    }
  }

  const handleDownloadGraph = async () => {
    setDownloadedBytes(null)
    setIsDownloading(true)
    setDownloadError(null)
    try {
      const bytes = await importDiscoverySnapshot({
        maxNodes,
        maxEdges,
        maxDistance,
        maxEdgesPerNode,
        replace,
      })
      setDownloadedBytes(bytes)
    } catch (error) {
      setDownloadError(error instanceof Error ? error.message : "Download failed")
    } finally {
      setIsDownloading(false)
    }
  }

  return (
    <div className="bg-base-200 min-h-full">
      <div className="p-4">
        <div className="space-y-6">
          <Statistics />

          <Maintenance />

          <FileOperations />

          <DownloadParameters
            maxNodes={maxNodes}
            setMaxNodes={setMaxNodes}
            maxEdges={maxEdges}
            setMaxEdges={setMaxEdges}
            maxDistance={maxDistance}
            setMaxDistance={setMaxDistance}
            maxEdgesPerNode={maxEdgesPerNode}
            setMaxEdgesPerNode={setMaxEdgesPerNode}
            isDownloading={isDownloading}
            downloadedBytes={downloadedBytes}
            downloadError={downloadError}
            replace={replace}
            setReplace={setReplace}
            fullBytes={full?.bytes}
            loadingFull={loadingFull}
            onFullDownload={handleFullDownload}
            onDownload={handleDownloadGraph}
          />

          <TopUsers />
        </div>
      </div>
    </div>
  )
}

export default SocialGraphSettings
