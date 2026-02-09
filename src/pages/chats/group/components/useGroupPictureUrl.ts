import {useCallback, useEffect, useState} from "react"
import {getMediaUrl, isImageFile, parseFileLink} from "@/lib/hashtree"

export function useGroupPictureUrl(picture?: string) {
  const [imageUrl, setImageUrl] = useState<string | null>(null)

  const resolve = useCallback(async (pic: string) => {
    const parsed = parseFileLink(pic)
    if (parsed && isImageFile(parsed.filename)) {
      return getMediaUrl(parsed.nhash, "image/*")
    }
    return pic
  }, [])

  useEffect(() => {
    setImageUrl(null)
    if (!picture) return

    let revoked = false
    let blobUrl: string | null = null

    resolve(picture)
      .then((url) => {
        if (revoked) return
        if (url.startsWith("blob:")) blobUrl = url
        setImageUrl(url)
      })
      .catch(() => {})

    return () => {
      revoked = true
      if (blobUrl) URL.revokeObjectURL(blobUrl)
    }
  }, [picture, resolve])

  return imageUrl
}
