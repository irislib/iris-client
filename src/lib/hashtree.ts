/**
 * Hashtree integration for encrypted file sharing in DMs
 *
 * Uses @hashtree/core to upload files CHK-encrypted to Blossom servers
 * and generate nhash links for sharing in chat messages.
 */

import {
  BlossomStore,
  HashTree,
  isNHash,
  nhashDecode,
  nhashEncode,
  type BlossomSigner,
} from "@hashtree/core"
import {NDKEvent} from "@/lib/ndk"
import {useUserStore} from "@/stores/user"
import {KIND_BLOSSOM_AUTH} from "@/utils/constants"
import {ndk} from "@/utils/ndk"

const DEFAULT_BLOSSOM_SERVERS = [
  {url: "https://upload.iris.to", write: true, read: true},
  {url: "https://cdn.iris.to", write: false, read: true},
]

let blossomStore: BlossomStore | null = null
let hashTree: HashTree | null = null

function createSigner(): BlossomSigner {
  return async (event) => {
    const signer = ndk().signer
    if (!signer) {
      throw new Error("No signer available")
    }

    const authEvent = new NDKEvent(ndk(), {
      kind: KIND_BLOSSOM_AUTH,
      created_at: event.created_at,
      content: event.content,
      tags: event.tags,
    })

    await authEvent.sign(signer)
    return authEvent.rawEvent()
  }
}

function getHashTree(): HashTree {
  if (!hashTree) {
    if (!useUserStore.getState().publicKey) {
      throw new Error("Not logged in")
    }

    blossomStore = new BlossomStore({
      servers: DEFAULT_BLOSSOM_SERVERS,
      signer: createSigner(),
    })

    hashTree = new HashTree({store: blossomStore})
  }

  return hashTree
}

export type UploadProgressCallback = (bytesUploaded: number, totalBytes: number) => void

export async function uploadFile(
  file: File,
  onProgress?: UploadProgressCallback
): Promise<{nhash: string; filename: string}> {
  const tree = getHashTree()
  const totalBytes = file.size

  const stream = tree.createStream()
  const reader = file.stream().getReader()
  let bytesRead = 0

  let done = false
  while (!done) {
    const result = await reader.read()
    done = result.done
    if (done || !result.value) break

    await stream.append(result.value)
    bytesRead += result.value.length
    onProgress?.(bytesRead, totalBytes)
  }

  const result = await stream.finalize()
  const cid = result.key ? {hash: result.hash, key: result.key} : {hash: result.hash}

  const nhash = nhashEncode(cid)

  return {nhash, filename: file.name}
}

export async function downloadFile(nhash: string): Promise<Uint8Array> {
  const tree = getHashTree()
  const cid = nhashDecode(nhash)
  const data = await tree.readFile(cid)
  if (!data) {
    throw new Error("File not found")
  }
  return data
}

export async function getMediaUrl(nhash: string, mimeType?: string): Promise<string> {
  const data = await downloadFile(nhash)
  const buffer = new ArrayBuffer(data.length)
  new Uint8Array(buffer).set(data)
  const blob = new Blob([buffer], {type: mimeType || "application/octet-stream"})
  return URL.createObjectURL(blob)
}

export function formatFileLink(nhash: string, filename: string): string {
  return `${nhash}/${encodeURIComponent(filename)}`
}

export function parseFileLink(link: string): {nhash: string; filename: string} | null {
  let cleaned = link
  if (cleaned.startsWith("htree://")) {
    cleaned = cleaned.substring(8)
  } else if (cleaned.startsWith("nhash://")) {
    cleaned = cleaned.substring(8)
  }

  const match = cleaned.match(/^(nhash1[a-z0-9]+)\/(.+)$/i)
  if (match) {
    return {nhash: match[1], filename: decodeURIComponent(match[2])}
  }

  return null
}

export const FILE_LINK_REGEX = /(?:htree:\/\/)?(nhash1[a-z0-9]+)\/([^\s]+)/gi

export function isImageFile(filename: string): boolean {
  const ext = filename.split(".").pop()?.toLowerCase()
  return ["jpg", "jpeg", "png", "gif", "webp", "svg", "bmp"].includes(ext || "")
}

export function isVideoFile(filename: string): boolean {
  const ext = filename.split(".").pop()?.toLowerCase()
  return ["mp4", "webm", "mov", "avi", "mkv"].includes(ext || "")
}

export function isAudioFile(filename: string): boolean {
  const ext = filename.split(".").pop()?.toLowerCase()
  return ["mp3", "wav", "ogg", "flac", "m4a", "aac"].includes(ext || "")
}

export function getMimeType(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase()
  const mimeTypes: Record<string, string> = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    gif: "image/gif",
    webp: "image/webp",
    svg: "image/svg+xml",
    bmp: "image/bmp",
    mp4: "video/mp4",
    webm: "video/webm",
    mov: "video/quicktime",
    avi: "video/x-msvideo",
    mkv: "video/x-matroska",
    mp3: "audio/mpeg",
    wav: "audio/wav",
    ogg: "audio/ogg",
    flac: "audio/flac",
    m4a: "audio/mp4",
    aac: "audio/aac",
    pdf: "application/pdf",
    txt: "text/plain",
    json: "application/json",
  }
  return mimeTypes[ext || ""] || "application/octet-stream"
}

export {isNHash}
