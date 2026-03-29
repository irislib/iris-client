import {formatSize} from "@/shared/utils/formatSize"
import {useEffect, useState, useMemo, useRef} from "react"
import {RiDownload2Line} from "@remixicon/react"
import {EmbedEvent} from "../index"
import {createDebugLogger} from "@/utils/createDebugLogger"
import {DEBUG_NAMESPACES} from "@/utils/constants"
import {usePauseMediaWhenHidden} from "@/shared/hooks/usePauseMediaWhenHidden"

const {log, error} = createDebugLogger(DEBUG_NAMESPACES.UTILS)

interface EncryptedUrlEmbedProps {
  url: string
  event?: EmbedEvent
}

function parseImetaEncryption(event: EmbedEvent, url: string) {
  try {
    // Find imeta tag for this URL or its index file (e.g. .bin, .chunks.json)
    const imetaTag = event.tags.find(
      (tag) =>
        tag[0] === "imeta" &&
        tag[1] &&
        tag[1].startsWith("url ") &&
        (tag[1].slice(4) === url ||
          // allow for chunked index file
          tag[1].slice(4).replace(/\.chunks\.(json|bin)$/, "") ===
            url.replace(/\.chunks\.(json|bin)$/, ""))
    )
    if (!imetaTag) {
      return null
    }
    // Extract encryption metadata from imeta tag
    const keyPart = imetaTag.find((part) => part.startsWith("decryption-key "))
    const namePart = imetaTag.find((part) => part.startsWith("name "))
    const sizePart = imetaTag.find((part) => part.startsWith("size "))
    const encryptionPart = imetaTag.find((part) =>
      part.startsWith("encryption-algorithm ")
    )
    const chunkSizePart = imetaTag.find((part) => part.startsWith("chunk-size "))

    if (keyPart && namePart && sizePart) {
      return {
        key: keyPart.split(" ")[1],
        name: namePart.substring(5), // Remove "name " prefix to handle spaces in filename
        size: parseInt(sizePart.split(" ")[1], 10),
        encryption: encryptionPart ? encryptionPart.split(" ")[1] : "AES-GCM",
        chunkSize: chunkSizePart ? parseInt(chunkSizePart.split(" ")[1], 10) : undefined,
      }
    }
  } catch (e) {
    // Silent error handling
  }
  return null
}

async function decryptAesGcm(
  encrypted: ArrayBuffer,
  keyHex: string
): Promise<ArrayBuffer> {
  const keyBytes = new Uint8Array(keyHex.match(/.{1,2}/g)!.map((b) => parseInt(b, 16)))
  const iv = new Uint8Array(encrypted.slice(0, 12))
  const data = encrypted.slice(12)
  const cryptoKey = await window.crypto.subtle.importKey(
    "raw",
    keyBytes,
    {name: "AES-GCM"},
    false,
    ["decrypt"]
  )
  return await window.crypto.subtle.decrypt({name: "AES-GCM", iv}, cryptoKey, data)
}

const isImage = (filename: string) => /\.(jpg|jpeg|png|gif|webp)$/i.test(filename)

const isVideo = (filename: string) => /\.(mp4|webm|ogg|mov|m3u8)$/i.test(filename)

// Helper: fetch and decrypt index file (if needed)
async function fetchAndParseIndex(url: string, keyHex?: string) {
  const resp = await fetch(url)
  if (!resp.ok) throw new Error("Failed to fetch index file")
  let buf = await resp.arrayBuffer()
  // If .bin, decrypt
  if (url.endsWith(".bin")) {
    if (!keyHex) throw new Error("Missing decryption key for index file")
    buf = await decryptAesGcm(buf, keyHex)
  }
  const text = new TextDecoder().decode(buf)
  return JSON.parse(text)
}

// Helper: stream, decrypt, and write all chunks directly to a file download
async function streamAndDecryptChunksToDownload({
  baseUrl,
  chunkHashes,
  keyHex,
  fileName,
  onProgress,
}: {
  baseUrl: string
  chunkHashes: string[]
  keyHex: string
  fileName: string
  onProgress?: (percent: number) => void
}) {
  log("[streamAndDecryptChunksToDownload] baseUrl:", baseUrl)
  log("[streamAndDecryptChunksToDownload] chunkHashes:", chunkHashes)
  // Create a stream for the browser download
  const stream = new ReadableStream({
    async pull(controller) {
      for (let i = 0; i < chunkHashes.length; i++) {
        const chunkUrl = baseUrl.replace(/[^/]+$/, `${chunkHashes[i]}.bin`)
        log(
          `[streamAndDecryptChunksToDownload] Fetching chunk ${i + 1}/${chunkHashes.length}:`,
          chunkUrl
        )
        const resp = await fetch(chunkUrl)
        if (!resp.ok) {
          error(
            `[streamAndDecryptChunksToDownload] Failed to fetch chunk ${i + 1}:`,
            chunkUrl,
            resp.status
          )
          throw new Error(`Failed to fetch chunk ${i + 1}`)
        }
        const encrypted = await resp.arrayBuffer()
        const decrypted = await decryptAesGcm(encrypted, keyHex)
        controller.enqueue(new Uint8Array(decrypted))
        if (onProgress) onProgress(Math.round(((i + 1) / chunkHashes.length) * 100))
      }
      controller.close()
    },
  })
  // Use the browser's download API
  if ("WritableStream" in window && "showSaveFilePicker" in window) {
    const showSaveFilePicker = window.showSaveFilePicker as (options: {
      suggestedName: string
    }) => Promise<unknown>
    const handle = await showSaveFilePicker({suggestedName: fileName})
    const writable = await (
      handle as unknown as {createWritable: () => Promise<WritableStream>}
    ).createWritable()
    await stream.pipeTo(writable)
  } else {
    const chunks: Uint8Array[] = []
    const reader = stream.getReader()
    let result
    while (!(result = await reader.read()).done) {
      chunks.push(result.value)
    }
    const blob = new Blob(chunks.map((chunk) => chunk.slice()))
    const a = document.createElement("a")
    const blobUrl = URL.createObjectURL(blob)
    a.href = blobUrl
    a.download = fileName
    document.body.appendChild(a)
    a.click()
    setTimeout(() => {
      URL.revokeObjectURL(blobUrl)
      document.body.removeChild(a)
    }, 1000)
  }
}

// Helper: check if a file is chunked (by imeta chunk-size only)
function isChunked(meta: unknown): boolean {
  return (
    typeof meta === "object" &&
    meta !== null &&
    "chunkSize" in meta &&
    typeof (meta as {chunkSize?: number}).chunkSize === "number"
  )
}

function EncryptedUrlEmbed({url, event}: EncryptedUrlEmbedProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  usePauseMediaWhenHidden(videoRef)
  const [blobUrl, setBlobUrl] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [progress, setProgress] = useState<number | null>(null)
  const meta = useMemo(
    () => (event ? parseImetaEncryption(event, url) : null),
    [event, url]
  )

  // Only display images inline if not chunked
  useEffect(() => {
    if (!meta || (!isImage(meta.name) && !isVideo(meta.name))) return
    if (isChunked(meta)) return // do not auto-display chunked media
    let revoked = false
    let currentBlobUrl: string | null = null
    setLoading(true)
    setErrorMessage(null)
    setBlobUrl(null)
    fetch(url)
      .then((res) => {
        if (!res.ok) throw new Error("Failed to fetch encrypted file")
        return res.arrayBuffer()
      })
      .then((encrypted) => decryptAesGcm(encrypted, meta.key))
      .then((decrypted) => {
        if (revoked) return
        const blob = new Blob([decrypted])
        const url = URL.createObjectURL(blob)
        currentBlobUrl = url
        setBlobUrl(url)
        setLoading(false)
      })
      .catch((err) => {
        setErrorMessage(err.message || "Failed to decrypt file")
        setLoading(false)
      })
    return () => {
      revoked = true
      if (currentBlobUrl) URL.revokeObjectURL(currentBlobUrl)
    }
  }, [url, meta])

  // Download handler (for all chunked files and non-chunked non-images)
  const handleDownload = async () => {
    if (!meta) return
    setLoading(true)
    setErrorMessage(null)
    setProgress(0)
    try {
      if (isChunked(meta)) {
        log("[handleDownload] Detected chunked file, meta:", meta)
        // 1. Fetch and decrypt index
        const index = await fetchAndParseIndex(url, meta.key)
        log("[handleDownload] Index file:", index)
        // 2. Stream, decrypt, and download all chunks directly (not the index file)
        await streamAndDecryptChunksToDownload({
          baseUrl: url,
          chunkHashes: index.chunkHashes,
          keyHex: meta.key,
          fileName: index.fileName || meta.name,
          onProgress: (p) => {
            setProgress(p)
            log(`[handleDownload] Progress: ${p}%`)
          },
        })
      } else {
        // Unchunked file logic (original)
        const resp = await fetchWithProgress(url, (p) => setProgress(p))
        if (!resp.ok) throw new Error("Failed to fetch encrypted file")
        const encrypted = await resp.arrayBuffer()
        const decrypted = await decryptAesGcm(encrypted, meta.key)
        const blob = new Blob([decrypted])
        const blobUrl = URL.createObjectURL(blob)
        const a = document.createElement("a")
        a.href = blobUrl
        a.download = meta.name
        document.body.appendChild(a)
        a.click()
        setTimeout(() => {
          URL.revokeObjectURL(blobUrl)
          document.body.removeChild(a)
        }, 1000)
      }
    } catch (err: unknown) {
      setErrorMessage(
        err instanceof Error ? err.message : String(err) || "Failed to decrypt file"
      )
      error("[handleDownload] Error:", err)
    } finally {
      setLoading(false)
      setProgress(null)
    }
  }

  // Helper for fetch with progress
  async function fetchWithProgress(url: string, onProgress: (percent: number) => void) {
    const resp = await fetch(url)
    if (!resp.body || !resp.ok) return resp
    const contentLength = Number(resp.headers.get("content-length"))
    if (!contentLength) return resp
    const reader = resp.body.getReader()
    let received = 0
    const chunks = []
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const {done, value} = await reader.read()
      if (done) break
      if (value) {
        chunks.push(value)
        received += value.length
        onProgress(Math.round((received / contentLength) * 100))
      }
    }
    const blob = new Blob(chunks)
    const arrayBuffer = await blob.arrayBuffer()
    // Assign a custom arrayBuffer method to the response object
    const respAny = resp as unknown as {arrayBuffer?: () => Promise<ArrayBuffer>}
    respAny.arrayBuffer = () => Promise.resolve(arrayBuffer)
    return resp
  }

  if (!meta) {
    // If no encryption metadata found, just show the URL as a link
    return (
      <a href={url} target="_blank" rel="noopener noreferrer" className="link">
        {url}
      </a>
    )
  }

  // If chunked, only show download button
  if (isChunked(meta)) {
    return (
      <div className="inline-flex flex-col items-start gap-1 w-full max-w-xs">
        <div className="flex items-center gap-2">
          <button
            className="btn btn-sm flex items-center gap-1"
            disabled={loading}
            onClick={handleDownload}
          >
            <RiDownload2Line size={16} />
            {loading ? "Decrypting..." : `Download ${meta.name}`}
          </button>
          <span className="text-xs">{formatSize(meta.size)}</span>
        </div>
        {loading && progress !== null && (
          <div className="w-full bg-base-200 rounded h-2 mt-1">
            <div className="bg-primary h-2 rounded" style={{width: `${progress}%`}}></div>
            <div className="text-xs mt-1">{progress}%</div>
          </div>
        )}
        {errorMessage && <span className="text-error text-xs">{errorMessage}</span>}
      </div>
    )
  }

  // Unchunked images: display inline
  if (isImage(meta.name)) {
    if (loading) return <div className="p-2 text-sm text-gray-500">Decrypting...</div>
    if (errorMessage) return <div className="p-2 text-sm text-error">{errorMessage}</div>
    if (blobUrl) {
      return (
        <img
          src={blobUrl}
          alt={meta.name}
          style={{maxWidth: "100%", maxHeight: 400, borderRadius: 8}}
        />
      )
    }
    return null
  }

  // Unchunked videos: display inline
  if (isVideo(meta.name)) {
    if (loading) return <div className="p-2 text-sm text-gray-500">Decrypting...</div>
    if (errorMessage) return <div className="p-2 text-sm text-error">{errorMessage}</div>
    if (blobUrl) {
      return (
        <video
          ref={videoRef}
          src={blobUrl}
          controls
          style={{maxWidth: "100%", maxHeight: 400, borderRadius: 8}}
        >
          Your browser does not support the video tag.
        </video>
      )
    }
    log("blobUrl", blobUrl)
    return null
  }

  // Non-image: show download button and progress
  return (
    <div className="inline-flex flex-col items-start gap-1 w-full max-w-xs">
      <div className="flex items-center gap-2">
        <button
          className="btn btn-sm flex items-center gap-1"
          disabled={loading}
          onClick={handleDownload}
        >
          <RiDownload2Line size={16} />
          {loading ? "Decrypting..." : `Download ${meta.name}`}
        </button>
        <span className="text-xs">{formatSize(meta.size)}</span>
      </div>
      {loading && progress !== null && (
        <div className="w-full bg-base-200 rounded h-2 mt-1">
          <div className="bg-primary h-2 rounded" style={{width: `${progress}%`}}></div>
          <div className="text-xs mt-1">{progress}%</div>
        </div>
      )}
      {errorMessage && <span className="text-error text-xs">{errorMessage}</span>}
    </div>
  )
}

export default EncryptedUrlEmbed
