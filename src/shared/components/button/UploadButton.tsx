import React, {useRef, useState, ReactNode} from "react"

import {processFile} from "@/shared/upload"

type Props = {
  onUpload: (
    url: string,
    metadata?: {width: number; height: number; blurhash: string}
  ) => void
  onError?: (error: Error) => void
  text?: ReactNode
  className?: string
  disabled?: boolean
  accept?: string
  multiple?: boolean
}

const UploadButton = ({
  onUpload,
  onError,
  text,
  className,
  disabled = false,
  accept,
  multiple = false,
}: Props) => {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState(0)
  const [currentFile, setCurrentFile] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [failedFiles, setFailedFiles] = useState<Array<{name: string; error: string}>>([])
  const [currentFileIndex, setCurrentFileIndex] = useState(0)
  const [totalFiles, setTotalFiles] = useState(0)

  const handleFileProcess = async (file: File): Promise<string | null> => {
    try {
      setCurrentFile(file.name)
      setProgress(0)
      setErrorMessage(null)

      const {url, metadata} = await processFile(file, (progress: number) => {
        setProgress(progress)
      })

      onUpload(url, metadata)
      return url
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      setErrorMessage(errorMessage)
      setFailedFiles((prev) => [...prev, {name: file.name, error: errorMessage}])
      if (onError) {
        onError(error instanceof Error ? error : new Error(String(error)))
      }
      return null
    }
  }

  const onChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) {
      return
    }

    try {
      setUploading(true)
      setFailedFiles([])
      const files = Array.from(e.target.files)
      setTotalFiles(files.length)
      setCurrentFileIndex(0)

      for (let i = 0; i < files.length; i++) {
        setCurrentFileIndex(i + 1)
        await handleFileProcess(files[i])
      }
    } finally {
      setUploading(false)
      setProgress(0)
      setCurrentFile(null)
      setCurrentFileIndex(0)
      setTotalFiles(0)
      // Clear the file input
      if (fileInputRef.current) {
        fileInputRef.current.value = ""
      }
    }
  }

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    fileInputRef.current?.click()
  }

  return (
    <div className="flex flex-col items-center">
      <button
        type="button"
        role="button"
        className={className || "btn btn-neutral"}
        onClick={handleClick}
        disabled={disabled || uploading}
      >
        {uploading ? "Uploading..." : text || "Upload"}
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        onChange={onChange}
        style={{display: "none"}}
      />
      {uploading && (
        <div className="w-full mt-2">
          {currentFile && (
            <p className="text-sm text-center mb-1">
              {totalFiles > 1 ? `[${currentFileIndex}/${totalFiles}] ` : ""}
              {currentFile}
            </p>
          )}
          <div className="bg-neutral rounded-full h-2.5">
            <div
              className="bg-primary h-2.5 rounded-full"
              style={{width: `${progress}%`}}
            ></div>
          </div>
          <p className="text-sm text-center mt-1">{Math.round(progress)}%</p>
        </div>
      )}
      {errorMessage && <p className="text-sm text-error mt-2">{errorMessage}</p>}
      {failedFiles.length > 0 && (
        <div className="w-full mt-2">
          <p className="text-sm font-semibold text-error mb-1">Failed uploads:</p>
          <div className="max-h-32 overflow-y-auto">
            {failedFiles.map((file, index) => (
              <p key={index} className="text-sm text-error">
                {file.name}: {file.error}
              </p>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export default UploadButton
