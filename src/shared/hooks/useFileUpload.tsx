import {useState} from "react"
import {processFile as defaultProcessFile} from "@/shared/upload"
import type {EncryptionMeta} from "@/types/global"

type FileProcessor = (
  file: File,
  onProgress?: (progress: number) => void
) => Promise<{
  url: string
  metadata?: {width: number; height: number; blurhash: string}
  encryptionMeta?: EncryptionMeta
  imetaTag?: string[]
}>

interface UseFileUploadOptions {
  onUpload: (
    url: string,
    metadata?: {width: number; height: number; blurhash: string},
    encryptionMeta?: EncryptionMeta,
    imetaTag?: string[]
  ) => void
  onError?: (error: Error) => void
  accept?: string
  processFile?: FileProcessor
}

export function useFileUpload({
  onUpload,
  onError,
  accept = "image/*",
  processFile = defaultProcessFile,
}: UseFileUploadOptions) {
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)

  const handleFileProcess = async (file: File): Promise<string | null> => {
    try {
      setUploading(true)
      setProgress(0)
      setError(null)

      const {url, metadata, encryptionMeta, imetaTag} = await processFile(
        file,
        (progress: number) => setProgress(progress)
      )

      onUpload(url, metadata, encryptionMeta, imetaTag)
      return url
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      setError(errorMessage)
      if (onError) {
        onError(error instanceof Error ? error : new Error(String(error)))
      }
      return null
    } finally {
      setUploading(false)
      setProgress(0)
    }
  }

  const triggerUpload = () => {
    const input = document.createElement("input")
    input.type = "file"
    input.accept = accept
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0]
      if (file) {
        handleFileProcess(file)
      }
    }
    input.click()
  }

  return {
    triggerUpload,
    uploading,
    progress,
    error,
  }
}
