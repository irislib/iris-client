import {useLocalState} from "irisdb-hooks/src/useLocalState"
import {RiAddCircleLine, RiAddLine} from "@remixicon/react" // Import Plus icon from Remix Icons
import classNames from "classnames" // Import classnames library
import {localState} from "irisdb"
import {useCallback} from "react"

let myPubKey = ""
localState.get("user/publicKey").on((k) => (myPubKey = k as string))

function PublishButton({
  className,
  showLabel = true,
}: {
  className?: string
  showLabel?: boolean
}) {
  // Add className prop
  const [newPostOpen, setNewPostOpen] = useLocalState("home/newPostOpen", false)

  const handlePress = useCallback(() => setNewPostOpen(!newPostOpen), [newPostOpen])

  if (!myPubKey) return null

  return (
    <>
      <div
        data-testid="new-post-button"
        className={classNames(
          "cursor-pointer flex flex-row items-center justify-center rounded-full",
          "primary md:bg-primary md:hover:bg-primary-hover md:text-white",
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
