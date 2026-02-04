import {RiDownload2Line} from "@remixicon/react"
import {useCallback, useEffect, useMemo, useState} from "react"
import {
  downloadFile,
  getMediaUrl,
  getMimeType,
  isAudioFile,
  isImageFile,
  isVideoFile,
  parseFileLink,
} from "@/lib/hashtree"
import Embed from "../index.ts"
import MediaModal from "../../media/MediaModal"

const HASHTREE_EMBED_REGEX = /(?:htree:\/\/)?(nhash1[a-z0-9]+\/[^\s]+)/gi

type HashtreeAttachmentEmbedProps = {
  match: string
}

const HashtreeAttachmentEmbed = ({match}: HashtreeAttachmentEmbedProps) => {
  const parsed = useMemo(() => parseFileLink(match), [match])
  const filename = parsed?.filename ?? ""
  const nhash = parsed?.nhash ?? ""

  const isImage = useMemo(() => (filename ? isImageFile(filename) : false), [filename])
  const isVideo = useMemo(() => (filename ? isVideoFile(filename) : false), [filename])
  const isAudio = useMemo(() => (filename ? isAudioFile(filename) : false), [filename])
  const isMedia = isImage || isVideo || isAudio
  const mimeType = useMemo(() => getMimeType(filename), [filename])
  const shouldAutoLoad = isImage

  const [mediaUrl, setMediaUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showModal, setShowModal] = useState(false)

  const loadMedia = useCallback(async () => {
    if (!parsed || !isMedia) return
    setLoading(true)
    setError(null)

    try {
      const url = await getMediaUrl(nhash, mimeType)
      setMediaUrl(url)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(message || "Failed to load")
    } finally {
      setLoading(false)
    }
  }, [parsed, isMedia, nhash, mimeType])

  useEffect(() => {
    if (!parsed || !shouldAutoLoad) return
    let revoked = false
    let currentUrl: string | null = null

    setLoading(true)
    setError(null)

    getMediaUrl(nhash, mimeType)
      .then((url) => {
        if (revoked) return
        currentUrl = url
        setMediaUrl(url)
        setLoading(false)
      })
      .catch((err) => {
        if (revoked) return
        const message = err instanceof Error ? err.message : String(err)
        setError(message || "Failed to load")
        setLoading(false)
      })

    return () => {
      revoked = true
      if (currentUrl) {
        URL.revokeObjectURL(currentUrl)
      }
    }
  }, [parsed, shouldAutoLoad, nhash, mimeType])

  useEffect(() => {
    return () => {
      if (mediaUrl) {
        URL.revokeObjectURL(mediaUrl)
      }
    }
  }, [mediaUrl])

  const handleDownload = useCallback(async () => {
    if (!parsed) return
    try {
      const data = await downloadFile(nhash)
      const buffer = new ArrayBuffer(data.length)
      new Uint8Array(buffer).set(data)
      const blob = new Blob([buffer], {type: mimeType})
      const url = URL.createObjectURL(blob)

      const anchor = document.createElement("a")
      anchor.href = url
      anchor.download = filename
      anchor.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(message || "Download failed")
    }
  }, [parsed, nhash, filename, mimeType])

  if (!parsed) {
    return match
  }

  return (
    <div className="mt-2" data-testid="hashtree-attachment">
      {loading && <div className="text-xs opacity-70">Loading {filename}...</div>}
      {error && !loading && <div className="text-xs text-error">{error}</div>}

      {!loading && !error && isImage && mediaUrl && (
        <img
          src={mediaUrl}
          alt={filename}
          className="max-w-full max-h-64 rounded-lg cursor-pointer"
          onClick={() => setShowModal(true)}
        />
      )}

      {!loading && !error && isVideo && mediaUrl && (
        <video
          src={mediaUrl}
          controls={true}
          className="max-w-full max-h-64 rounded-lg"
        />
      )}

      {!loading && !error && isAudio && mediaUrl && (
        <audio src={mediaUrl} controls={true} className="w-full max-w-xs" />
      )}

      {!loading && !error && isMedia && !mediaUrl && (
        <button type="button" onClick={loadMedia} className="btn btn-ghost btn-sm">
          Load {filename}
        </button>
      )}

      {!loading && !error && !isMedia && (
        <button
          type="button"
          onClick={handleDownload}
          className="btn btn-ghost btn-sm flex items-center gap-2"
        >
          <RiDownload2Line size={16} />
          <span className="truncate max-w-xs">{filename}</span>
        </button>
      )}

      {showModal && isImage && mediaUrl && (
        <MediaModal
          onClose={() => setShowModal(false)}
          mediaUrl={mediaUrl}
          mediaType="image"
          showFeedItem={false}
        />
      )}
    </div>
  )
}

const HashtreeAttachment: Embed = {
  regex: HASHTREE_EMBED_REGEX,
  component: (props) => <HashtreeAttachmentEmbed match={props.match} />,
}

export default HashtreeAttachment
