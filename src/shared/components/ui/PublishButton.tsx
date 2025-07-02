import {RiAddCircleLine, RiAddLine} from "@remixicon/react" // Import Plus icon from Remix Icons
import {usePublicKey} from "@/stores/user"
import {useUIStore} from "@/stores/ui"
import classNames from "classnames" // Import classnames library
import {useCallback} from "react"

function PublishButton({
  className,
  showLabel = true,
}: {
  className?: string
  showLabel?: boolean
}) {
  // Add className prop
  const {newPostOpen, setNewPostOpen} = useUIStore()
  const myPubKey = usePublicKey()

  const handlePress = useCallback(
    () => setNewPostOpen(!newPostOpen),
    [newPostOpen, setNewPostOpen]
  )

  if (!myPubKey) return null

  return (
    <>
      <div
        data-testid="new-post-button"
        className={classNames(
          "cursor-pointer flex flex-row items-center justify-center rounded-full",
          "btn-publish",
          {
            "p-4 md:p-2 aspect-auto md:aspect-square xl:aspect-auto xl:p-4": showLabel,
            "aspect-square": !showLabel,
          },
          className
        )}
        onClick={handlePress}
      >
        <RiAddCircleLine className="md:hidden" />
        <RiAddLine className="hidden md:inline" />
        {showLabel && <span className="ml-2 inline md:hidden xl:inline">New post</span>}
      </div>
    </>
  )
}

export default PublishButton
