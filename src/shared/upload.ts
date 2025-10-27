import {
  calculateImageMetadata,
  calculateVideoMetadata,
} from "@/shared/components/embed/media/mediaUtils"
import type {EncryptionMeta} from "@/types/global"
import {NDKEvent} from "@nostr-dev-kit/ndk"
import {useUserStore} from "@/stores/user"
import {ndk} from "@/utils/ndk"
import {KIND_HTTP_AUTH} from "@/utils/constants"
import {uploadToBlossom} from "./upload/blossom"
import {calculateSHA256, encryptFileWithAesGcm} from "./upload/utils"
import type {MediaServer} from "./upload/types"

// Re-export types for backward compatibility
export type {MediaServer, MediaServerProtocol} from "./upload/types"

// These functions are now imported from ./upload/utils

// uploadToBlossom is now imported from ./upload/blossom

async function uploadToNip96(
  file: File,
  server: MediaServer,
  onProgress?: (progress: number) => void
): Promise<string> {
  const url = server.url

  // Use FormData with 'fileToUpload' and 'submit'
  const fd = new FormData()
  fd.append("fileToUpload", file)
  fd.append("submit", "Upload Image")

  // Create a NIP-98 event for authentication
  const currentTime = Math.floor(Date.now() / 1000)
  const event = new NDKEvent(ndk(), {
    kind: KIND_HTTP_AUTH, // NIP-98 HTTP authentication
    tags: [
      ["u", url],
      ["method", "POST"],
    ],
    content: "",
    created_at: currentTime,
  })
  await event.sign()
  const nostrEvent = await event.toNostrEvent()
  const encodedEvent = btoa(JSON.stringify(nostrEvent))
  const headers = {
    accept: "application/json",
    authorization: `Nostr ${encodedEvent}`,
  }

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open("POST", url)
    Object.entries(headers).forEach(([key, value]) => {
      xhr.setRequestHeader(key, value)
    })

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && onProgress) {
        const percentComplete = Math.round((event.loaded / event.total) * 100)
        onProgress(percentComplete)
      }
    }

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const data = JSON.parse(xhr.responseText)
          // Try to find the URL in the response (may need to adjust if server format changes)
          let urlResult = null
          if (data.nip94_event && Array.isArray(data.nip94_event.tags)) {
            const urlTag = data.nip94_event.tags.find((tag: string[]) => tag[0] === "url")
            if (urlTag && urlTag[1]) {
              urlResult = urlTag[1]
            }
          }
          if (!urlResult && data.url) {
            urlResult = data.url
          }
          if (urlResult) {
            resolve(urlResult)
          } else {
            reject(new Error(`URL not found in response: ${xhr.responseText}`))
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error)
          reject(
            new Error(
              `Failed to parse response from ${url}: ${errorMessage} - Raw: ${xhr.responseText}`
            )
          )
        }
      } else {
        // Improved error logging for 401 and other errors
        let errorMsg = `Upload failed with status ${xhr.status} from ${url}`
        if (xhr.status === 401) {
          errorMsg +=
            " (Unauthorized). Check your authentication headers and Nostr event."
        }
        errorMsg += `\nResponse: ${xhr.responseText}`
        reject(new Error(errorMsg))
      }
    }

    xhr.onerror = () => reject(new Error(`Upload to ${url} failed`))
    xhr.send(fd)
  })
}

// --- Shared file processing logic ---

export const CHUNK_SIZE = 4 * 1024 * 1024 // 4 MB

async function uploadChunk(
  chunk: Blob,
  fileName: string,
  server: MediaServer,
  onProgress?: (progress: number) => void,
  encrypt: boolean = false,
  keyOverride?: Uint8Array
): Promise<{url: string; hash: string; encryptionMeta?: EncryptionMeta}> {
  let encryptionMeta: EncryptionMeta | undefined = undefined
  let uploadBlob = chunk
  let chunkFileName = fileName
  if (encrypt) {
    const {encryptedFile, key} = await encryptFileWithAesGcm(
      new File([chunk], fileName),
      keyOverride
    )
    const hash = await calculateSHA256(encryptedFile)
    chunkFileName = `${hash}.enc`
    uploadBlob = encryptedFile
    encryptionMeta = {
      decryptionKey: key,
      fileName: fileName,
      fileSize: chunk.size,
      algorithm: "AES-GCM",
    }
  }
  const chunkFile = new File([uploadBlob], chunkFileName, {
    type: "application/octet-stream",
  })
  let url: string
  if (server.protocol === "blossom") {
    url = await uploadToBlossom(chunkFile, server, onProgress)
  } else if (server.protocol === "nip96") {
    url = await uploadToNip96(chunkFile, server, onProgress)
  } else {
    throw new Error(`Unsupported media server protocol: ${server.protocol}`)
  }
  const hash = await calculateSHA256(
    uploadBlob instanceof File ? uploadBlob : new File([uploadBlob], fileName)
  )
  return {url, hash, encryptionMeta}
}

function getDefaultMediaServer(isSubscriber: boolean): MediaServer {
  const userStore = useUserStore.getState()
  let server = userStore.defaultMediaserver
  if (!server) {
    userStore.ensureDefaultMediaserver(isSubscriber)
    server = useUserStore.getState().defaultMediaserver
  }
  if (!server) throw new Error("No default media server configured")
  return server
}

async function uploadSingleFile(
  file: File,
  server: MediaServer,
  onProgress?: (progress: number) => void,
  encrypt: boolean = false,
  width?: number,
  height?: number,
  blurhash?: string
): Promise<{
  url: string
  encryptionMeta?: EncryptionMeta
  imetaTag: string[]
}> {
  let encryptionMeta: EncryptionMeta | undefined = undefined
  let uploadFileObj = file
  if (encrypt) {
    const {encryptedFile, key} = await encryptFileWithAesGcm(file)
    const hash = await calculateSHA256(encryptedFile)
    uploadFileObj = new File([encryptedFile], `${hash}.enc`, {
      type: "application/octet-stream",
    })
    encryptionMeta = {
      decryptionKey: key,
      fileName: file.name,
      fileSize: file.size,
      algorithm: "AES-GCM",
    }
  }
  let url: string
  if (server.protocol === "blossom") {
    url = await uploadToBlossom(uploadFileObj, server, onProgress)
  } else if (server.protocol === "nip96") {
    url = await uploadToNip96(uploadFileObj, server, onProgress)
  } else {
    throw new Error(`Unsupported media server protocol: ${server.protocol}`)
  }
  // Generate imeta tag for single file upload (no chunk-size)
  const imetaTag = generateImetaTag({
    url,
    fileName: file.name,
    fileSize: file.size,
    encryptionMeta,
    width,
    height,
    blurhash,
  })
  return {url, encryptionMeta, imetaTag}
}

async function createIndexFile(
  realFilename: string,
  originalSize: number,
  chunkHashes: string[],
  encrypt: boolean
): Promise<{file: File; encryptionMeta?: EncryptionMeta}> {
  const indexJson = {
    fileName: realFilename,
    size: originalSize,
    chunkSize: CHUNK_SIZE,
    chunkHashes,
  }
  const blob = new Blob([JSON.stringify(indexJson)], {type: "application/json"})
  if (!encrypt) {
    const indexFile = new File([blob], `${realFilename}.chunks.json`, {
      type: "application/json",
    })
    return {file: indexFile}
  } else {
    const {encryptedFile, key} = await encryptFileWithAesGcm(
      new File([blob], `${realFilename}.chunks.json`)
    )
    const hash = await calculateSHA256(encryptedFile)
    const indexFile = new File([encryptedFile], `${hash}.bin`, {
      type: "application/octet-stream",
    })
    const encryptionMeta: EncryptionMeta = {
      decryptionKey: key,
      fileName: `${realFilename}.chunks.json`,
      fileSize: blob.size,
      algorithm: "AES-GCM",
    }
    return {file: indexFile, encryptionMeta}
  }
}

// Helper to generate imeta tag for uploads
function generateImetaTag({
  url,
  fileName,
  fileSize,
  encryptionMeta,
  chunkSize,
  width,
  height,
  blurhash,
}: {
  url: string
  fileName: string
  fileSize: number
  encryptionMeta?: EncryptionMeta
  chunkSize?: number
  width?: number
  height?: number
  blurhash?: string
}): string[] {
  const tag = ["imeta", `url ${url}`, `name ${fileName}`, `size ${fileSize}`]
  if (encryptionMeta?.decryptionKey) {
    tag.push(`decryption-key ${encryptionMeta.decryptionKey}`)
    tag.push(`encryption-algorithm ${encryptionMeta.algorithm}`)
  }
  if (chunkSize) {
    tag.push(`chunk-size ${chunkSize}`)
  }
  if (width && height) {
    tag.push(`dimensions ${width}x${height}`)
  }
  if (blurhash) {
    tag.push(`blurhash ${blurhash}`)
  }
  return tag
}

async function uploadChunkedFile(
  file: File,
  server: MediaServer,
  onProgress?: (progress: number) => void,
  encrypt: boolean = false,
  width?: number,
  height?: number,
  blurhash?: string
): Promise<{
  url: string
  encryptionMeta?: EncryptionMeta
  chunkSize: number
  imetaTag: string[]
}> {
  const realFilename = file.name
  const originalSize = file.size
  const numChunks = Math.ceil(file.size / CHUNK_SIZE)
  const chunkHashes: string[] = []
  let totalUploaded = 0
  let keyBytes: Uint8Array | undefined = undefined
  let encryptionMeta: EncryptionMeta | undefined = undefined
  if (encrypt) {
    // Generate a single key for all chunks and the index file
    keyBytes = crypto.getRandomValues(new Uint8Array(32))
  }
  for (let i = 0; i < numChunks; i++) {
    const start = i * CHUNK_SIZE
    const end = Math.min(start + CHUNK_SIZE, file.size)
    const chunk = file.slice(start, end)
    const chunkName = `${realFilename}.chunk${i + 1}_of_${numChunks}`
    const progressCb = onProgress
      ? (progress: number) => {
          const chunkProgress = (progress / 100) * (end - start)
          const overallProgress = Math.round(
            ((totalUploaded + chunkProgress) / file.size) * 100
          )
          onProgress(overallProgress)
        }
      : undefined
    const {hash} = await uploadChunk(
      chunk,
      chunkName,
      server,
      progressCb,
      encrypt,
      keyBytes
    )
    chunkHashes.push(hash)
    totalUploaded += end - start
  }
  // Create index file with the same key
  let indexFileResult
  if (encrypt) {
    indexFileResult = await (async () => {
      const indexJson = {
        fileName: realFilename,
        size: originalSize,
        chunkSize: CHUNK_SIZE,
        chunkHashes,
      }
      const blob = new Blob([JSON.stringify(indexJson)], {type: "application/json"})
      const {encryptedFile, key} = await encryptFileWithAesGcm(
        new File([blob], `${realFilename}.chunks.json`),
        keyBytes
      )
      const hash = await calculateSHA256(encryptedFile)
      const indexFile = new File([encryptedFile], `${hash}.enc`, {
        type: "application/octet-stream",
      })
      encryptionMeta = {
        decryptionKey: key,
        fileName: `${realFilename}.chunks.json`,
        fileSize: blob.size,
        algorithm: "AES-GCM",
      }
      return {file: indexFile, encryptionMeta}
    })()
  } else {
    indexFileResult = await createIndexFile(
      realFilename,
      originalSize,
      chunkHashes,
      false
    )
    encryptionMeta = undefined
  }
  let indexUrl: string
  if (server.protocol === "blossom") {
    indexUrl = await uploadToBlossom(indexFileResult.file, server, onProgress)
  } else if (server.protocol === "nip96") {
    indexUrl = await uploadToNip96(indexFileResult.file, server, onProgress)
  } else {
    throw new Error(`Unsupported media server protocol: ${server.protocol}`)
  }
  if (encryptionMeta) {
    ;(encryptionMeta as EncryptionMeta & {chunkSize?: number}).chunkSize = CHUNK_SIZE
  }
  // Generate imeta tag for chunked upload
  const imetaTag = generateImetaTag({
    url: indexUrl,
    fileName: realFilename,
    fileSize: originalSize,
    encryptionMeta,
    chunkSize: CHUNK_SIZE,
    width,
    height,
    blurhash,
  })
  return {
    url: indexUrl,
    encryptionMeta,
    chunkSize: CHUNK_SIZE,
    imetaTag,
  }
}

export async function uploadFile(
  file: File,
  onProgress?: (progress: number) => void,
  isSubscriber: boolean = false,
  encrypt: boolean = false,
  width?: number,
  height?: number,
  blurhash?: string
): Promise<{
  url: string
  encryptionMeta?: EncryptionMeta
  chunkSize?: number
  imetaTag: string[]
}> {
  const server = getDefaultMediaServer(isSubscriber)
  if (encrypt) {
    if (file.size <= CHUNK_SIZE) {
      return uploadSingleFile(file, server, onProgress, true, width, height, blurhash)
    } else {
      return uploadChunkedFile(file, server, onProgress, true, width, height, blurhash)
    }
  } else {
    // For unencrypted files, always use single file upload regardless of size
    // other clients dont support chunking yet
    return uploadSingleFile(file, server, onProgress, false, width, height, blurhash)
  }
}

export const hasExifData = async (file: File): Promise<boolean> => {
  return new Promise((resolve) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      const view = new DataView(e.target?.result as ArrayBuffer)
      // Check for JPEG signature
      if (view.getUint16(0, false) === 0xffd8) {
        const length = view.byteLength
        let offset = 2
        while (offset < length) {
          if (view.getUint16(offset, false) === 0xffe1) {
            resolve(true)
            return
          }
          offset += 2 + view.getUint16(offset + 2, false)
        }
      }
      resolve(false)
    }
    reader.readAsArrayBuffer(file)
  })
}

export const stripExifData = async (file: File): Promise<File> => {
  if (file.type !== "image/jpeg") return file
  const hasExif = await hasExifData(file)
  if (!hasExif) return file
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement("canvas")
      canvas.width = img.width
      canvas.height = img.height
      const ctx = canvas.getContext("2d")
      if (!ctx) return resolve(file)
      ctx.drawImage(img, 0, 0)
      canvas.toBlob((blob) => {
        if (blob) {
          const newFile = new File([blob], file.name, {
            type: file.type,
            lastModified: file.lastModified,
          })
          resolve(newFile)
        } else {
          resolve(file)
        }
      }, file.type)
    }
    img.onerror = () => resolve(file)
    img.src = URL.createObjectURL(file)
  })
}

export async function processFile(
  file: File,
  onProgress?: (progress: number) => void,
  encrypt: boolean = false,
  width?: number,
  height?: number,
  blurhash?: string
): Promise<{
  url: string
  metadata?: {width: number; height: number; blurhash: string}
  encryptionMeta?: EncryptionMeta
  imetaTag: string[]
}> {
  // Strip EXIF data if it's a JPEG
  if (file.type === "image/jpeg") {
    file = await stripExifData(file)
  }
  // Calculate metadata based on file type
  let metadata
  if (file.type.startsWith("image/")) {
    metadata = await calculateImageMetadata(file)
  } else if (file.type.startsWith("video/")) {
    metadata = await calculateVideoMetadata(file)
  }
  const {url, encryptionMeta, imetaTag} = await uploadFile(
    file,
    onProgress,
    false,
    encrypt,
    width,
    height,
    blurhash
  )
  return {url, metadata: metadata || undefined, encryptionMeta, imetaTag}
}
