import {useState} from "react"

import InfiniteScroll from "@/shared/components/ui/InfiniteScroll.tsx" // Make sure to import InfiniteScroll
import ProfileCard from "@/shared/components/user/ProfileCard"
import useFollows from "@/shared/hooks/useFollows"
import useRecommendationVisibilitySnapshot from "@/shared/hooks/useRecommendationVisibilitySnapshot"
import {shouldHideUser} from "@/utils/visibility"

interface FollowListProps {
  follows?: string[]
  pubKey?: string
  initialDisplayCount?: number
  showAbout?: boolean
  visibility?: "explicit" | "recommendation"
}

function FollowList({
  follows,
  pubKey = "",
  initialDisplayCount = 10,
  showAbout = false,
  visibility = "explicit",
}: FollowListProps) {
  const [displayCount, setDisplayCount] = useState<number>(initialDisplayCount) // Start by displaying 10 items
  const f = useFollows(pubKey)
  const recommendationPolicy = useRecommendationVisibilitySnapshot(
    visibility === "recommendation"
  )

  if (!pubKey && !follows) {
    throw new Error("FollowList needs follows or pubKey param")
  }

  const localFollows = follows && follows.length > 0 ? follows : f

  if (
    visibility === "recommendation" &&
    (!recommendationPolicy.ready || !recommendationPolicy.snapshot)
  ) {
    return <div className="px-4 py-2 text-base-content/50 text-sm">Loading people...</div>
  }

  const visibleFollows = localFollows.filter((pubkey) =>
    visibility === "recommendation"
      ? !!recommendationPolicy.snapshot &&
        !recommendationPolicy.snapshot.shouldHideRecommendationUser(pubkey)
      : // Explicit people lists should still show unknown users; only mute-based hiding applies.
        !shouldHideUser(pubkey, 1, true)
  )

  const loadMoreFollows = () => {
    if (displayCount < visibleFollows.length) {
      setDisplayCount((prevCount) =>
        Math.min(prevCount + initialDisplayCount * 2, visibleFollows.length)
      ) // Load 10 more items at a time
    }
  }

  return (
    <>
      <InfiniteScroll onLoadMore={loadMoreFollows}>
        <div className="flex flex-col gap-2">
          {visibleFollows.slice(0, displayCount).map((pubkey) => (
            <ProfileCard key={pubkey} pubKey={pubkey} showAbout={showAbout} />
          ))}
        </div>
      </InfiniteScroll>
    </>
  )
}

export default FollowList
