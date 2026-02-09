import {useGroupPictureUrl} from "./useGroupPictureUrl"

interface GroupAvatarProps {
  picture?: string
  size?: number
  onClick?: () => void
}

export default function GroupAvatar({picture, size = 48, onClick}: GroupAvatarProps) {
  const imageUrl = useGroupPictureUrl(picture)
  const px = `${size}px`

  if (imageUrl) {
    return (
      <img
        src={imageUrl}
        alt="Group"
        className={`rounded-full object-cover${onClick ? " cursor-pointer" : ""}`}
        style={{width: px, height: px}}
        onClick={onClick}
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
