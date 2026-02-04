import {formatFileLink, uploadFile} from "@/lib/hashtree"
import type {EncryptionMeta} from "@/types/global"

export type HashtreeUploadResult = {
  url: string
  metadata?: {width: number; height: number; blurhash: string}
  encryptionMeta?: EncryptionMeta
  imetaTag?: string[]
}

export async function processHashtreeFile(
  file: File,
  onProgress?: (progress: number) => void
): Promise<HashtreeUploadResult> {
  const {nhash} = await uploadFile(file, (bytesUploaded, totalBytes) => {
    if (!onProgress) return
    const percent = Math.round((bytesUploaded / totalBytes) * 100)
    onProgress(percent)
  })

  return {url: formatFileLink(nhash, file.name)}
}
