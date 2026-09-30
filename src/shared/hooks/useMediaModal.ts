import {useState, useCallback} from "react"
import {AppEvent} from "@/lib/nostr"
import {MediaItem} from "./useMediaExtraction"

const MAX_MODAL_MEDIA = 200 // Limit modal media to prevent crashes

export function useMediaModal() {
  const [showModal, setShowModal] = useState(false)
  const [activeItemIndex, setActiveItemIndex] = useState<number | null>(null)
  const [modalMedia, setModalMedia] = useState<MediaItem[]>([])

  const openModal = useCallback(
    (allMedia: MediaItem[], clickedEvent: AppEvent, clickedUrl: string) => {
      const mediaIndex = allMedia.findIndex(
        (media) => media.event.id === clickedEvent.id && media.url === clickedUrl
      )

      if (mediaIndex === -1) {
        return false
      }

      // Limit modal media size to prevent mobile crashes
      const limitedMediaArray =
        allMedia.length > MAX_MODAL_MEDIA
          ? allMedia.slice(
              Math.max(0, mediaIndex - MAX_MODAL_MEDIA / 2),
              mediaIndex + MAX_MODAL_MEDIA / 2
            )
          : allMedia

      // Adjust index for the limited array
      const adjustedIndex =
        allMedia.length > MAX_MODAL_MEDIA
          ? Math.min(mediaIndex, MAX_MODAL_MEDIA / 2)
          : mediaIndex

      setModalMedia(limitedMediaArray)
      setActiveItemIndex(adjustedIndex)
      setShowModal(true)
      return true
    },
    []
  )

  const closeModal = useCallback(() => {
    setShowModal(false)
    setActiveItemIndex(null)
    setModalMedia([])
  }, [])

  const clearModal = useCallback(() => {
    setModalMedia([])
  }, [])

  return {
    showModal,
    activeItemIndex,
    modalMedia,
    openModal,
    closeModal,
    clearModal,
  }
}
