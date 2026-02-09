import {useCallback, useEffect, useState} from "react"
import {getMediaUrl, isImageFile, parseFileLink} from "@/lib/hashtree"

interface GroupAvatarProps {
  picture?: string
  size?: number
}

export default function GroupAvatar({picture, size = 48}: GroupAvatarProps) {
  const [imageUrl, setImageUrl] = useState<string | null>(null)

  const resolve = useCallback(async (pic: string) => {
    const parsed = parseFileLink(pic)
    if (parsed && isImageFile(parsed.filename)) {
      return getMediaUrl(parsed.nhash, "image/*")
    }
    // Regular URL — use directly
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
        // Track blob URLs so we can revoke them
        if (url.startsWith("blob:")) blobUrl = url
        setImageUrl(url)
      })
      .catch(() => {})

    return () => {
      revoked = true
      if (blobUrl) URL.revokeObjectURL(blobUrl)
    }
  }, [picture, resolve])

  const px = `${size}px`

  if (imageUrl) {
    return (
      <img
        src={imageUrl}
        alt="Group"
        className="rounded-full object-cover"
        style={{width: px, height: px}}
      />
    )
  }

  return (
    <div
      className="rounded-full bg-base-300 flex items-center justify-center"
      style={{width: px, height: px}}
    >
      <span style={{fontSize: `${Math.round(size * 0.45)}px`}}>👥</span>
    </div>
  )
}
