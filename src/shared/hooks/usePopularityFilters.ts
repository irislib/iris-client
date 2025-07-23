import {useState, useCallback, useMemo, useEffect} from "react"
import socialGraph, {DEFAULT_SOCIAL_GRAPH_ROOT} from "@/utils/socialGraph"
import useFollows from "@/shared/hooks/useFollows"
import {useUserStore} from "@/stores/user"

const BASE_TIME_RANGE = 24 * 60 * 60
const BASE_LIMIT = 300

export interface PopularityFilters {
  timeRange: number
  limit: number
  authors: string[] | undefined
}

function calculateFilters(level: number, baseAuthors: string[]): PopularityFilters {
  const timeMultiplier = Math.pow(2, level) // 1x, 2x, 4x, 8x days
  const limitMultiplier = Math.pow(1.5, level) // 1x, 1.5x, 2.25x, 3.375x limit

  let currentAuthors = baseAuthors

  if (level >= 2) {
    const expandedAuthors = new Set(baseAuthors)
    baseAuthors.forEach((pubkey) => {
      const secondDegreeFollows = socialGraph().getFollowedByUser(pubkey)
      secondDegreeFollows.forEach((follow) => expandedAuthors.add(follow))
    })
    currentAuthors = Array.from(expandedAuthors)
  }

  if (level >= 4) {
    currentAuthors = []
  }

  return {
    timeRange: BASE_TIME_RANGE * timeMultiplier,
    limit: Math.floor(BASE_LIMIT * limitMultiplier),
    authors: currentAuthors.length > 0 ? currentAuthors : undefined,
  }
}

export default function usePopularityFilters() {
  const [filterLevel, setFilterLevel] = useState(0)
  const [currentFilters, setCurrentFilters] = useState<PopularityFilters>({
    timeRange: BASE_TIME_RANGE,
    limit: BASE_LIMIT,
    authors: undefined,
  })

  const myPubKey = useUserStore((state) => state.publicKey)
  const myFollows = useFollows(myPubKey, false)
  const shouldUseFallback = myFollows.length === 0

  const baseAuthors = useMemo(() => {
    if (shouldUseFallback) {
      return Array.from(socialGraph().getFollowedByUser(DEFAULT_SOCIAL_GRAPH_ROOT))
    }
    return myFollows
  }, [shouldUseFallback, myFollows])

  useEffect(() => {
    setCurrentFilters(calculateFilters(filterLevel, baseAuthors))
  }, [filterLevel, baseAuthors])

  const expandFilters = useCallback(() => {
    setFilterLevel((prev) => prev + 1)
  }, [])

  return {
    currentFilters,
    expandFilters,
  }
}
