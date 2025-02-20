import ProxyImg from "../ProxyImg"

interface PreloadImagesProps {
  images: string[]
  currentIndex: number
  size?: number | null
}

function PreloadImages({images, currentIndex, size}: PreloadImagesProps) {
  if (images.length === 0) return null

  const nextIndex = (currentIndex + 1) % images.length
  const prevIndex = (currentIndex - 1 + images.length) % images.length

  return (
    <div className="hidden">
      <ProxyImg
        key={`preload-next-${nextIndex}-${images[nextIndex]}`}
        src={images[nextIndex]}
        width={size ?? undefined}
      />
      <ProxyImg
        key={`preload-prev-${prevIndex}-${images[prevIndex]}`}
        src={images[prevIndex]}
        width={size ?? undefined}
      />
    </div>
  )
}

export default PreloadImages
