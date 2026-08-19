import {useState, useEffect, useMemo} from "react"
import {nip19} from "nostr-tools"
import {useSocialGraph} from "@/utils/socialGraph"
import {Link, useNavigate} from "@/navigation"
import Widget from "@/shared/components/ui/Widget"
import {formatAmount} from "@/utils/utils"
import useRecommendationVisibilitySnapshot from "@/shared/hooks/useRecommendationVisibilitySnapshot"

interface SocialGraphWidgetProps {
  background?: boolean
}

export function SocialGraphWidget({background = true}: SocialGraphWidgetProps = {}) {
  const socialGraph = useSocialGraph()
  const [socialGraphSize, setSocialGraphSize] = useState(socialGraph.size())
  const navigate = useNavigate()
  const recommendationPolicy = useRecommendationVisibilitySnapshot()

  useEffect(() => {
    const updateStats = () => {
      setSocialGraphSize(socialGraph.size())
    }

    updateStats()
    const interval = setInterval(updateStats, 2000)
    return () => clearInterval(interval)
  }, [socialGraph])

  const distanceData = socialGraphSize.sizeByDistance || {}
  const distance1 = distanceData[1] || 0
  const distance2 = distanceData[2] || 0
  const distance3Plus = Object.entries(distanceData)
    .filter(([d]) => Number(d) >= 3)
    .reduce((sum, [, count]) => sum + count, 0)

  const {visibleDistance1, visibleDistance2, visibleDistance3Plus} = useMemo(() => {
    const snapshot = recommendationPolicy.snapshot
    if (!recommendationPolicy.ready || !snapshot) {
      return {visibleDistance1: [], visibleDistance2: [], visibleDistance3Plus: []}
    }

    const visibleUsersAtDistance = (distance: number) =>
      Array.from(socialGraph.getUsersByFollowDistance(distance) || []).filter(
        (pubKey) => !snapshot.shouldHideRecommendationUser(pubKey)
      )
    const policyDistanceData = socialGraph.size().sizeByDistance || {}

    return {
      visibleDistance1: visibleUsersAtDistance(1),
      visibleDistance2: visibleUsersAtDistance(2),
      visibleDistance3Plus: Object.keys(policyDistanceData)
        .map(Number)
        .filter((distance) => distance >= 3)
        .flatMap(visibleUsersAtDistance),
    }
  }, [recommendationPolicy.ready, recommendationPolicy.snapshot, socialGraph])

  const pickRandom = (users: string[]) => {
    if (users.length === 0) return
    const randomUser = users[Math.floor(Math.random() * users.length)]
    navigate(`/${nip19.npubEncode(randomUser)}`)
  }

  return (
    <Widget title={false} background={background} className="h-auto">
      <div className="p-3">
        <Link to="/settings/social-graph" className="inline-block mb-2">
          <h3 className="font-semibold text-sm opacity-80 hover:opacity-100 cursor-pointer transition-opacity underline decoration-dotted underline-offset-2">
            Social Graph
          </h3>
        </Link>
        <div className="grid grid-cols-3 gap-3 text-xs mb-3">
          <div>
            <div className="font-bold text-xl">
              {formatAmount(socialGraphSize.users, 3)}
            </div>
            <div className="opacity-60">Users</div>
          </div>
          <div>
            <div className="font-bold text-xl">
              {formatAmount(socialGraphSize.follows, 3)}
            </div>
            <div className="opacity-60">Follows</div>
          </div>
          <div>
            <div className="font-bold text-xl">
              {formatAmount(socialGraphSize.mutes, 3)}
            </div>
            <div className="opacity-60">Mutes</div>
          </div>
        </div>
        <div className="border-t border-base-300/50 pt-3">
          <div className="text-xs opacity-80 mb-2">Distance from you</div>
          <div className="grid grid-cols-3 gap-3 text-xs">
            <div>
              <div className="font-bold text-lg">{formatAmount(distance1, 3)}</div>
              <div className="opacity-60">1 hop</div>
              {visibleDistance1.length > 0 && (
                <button
                  onClick={() => pickRandom(visibleDistance1)}
                  className="text-[10px] link link-info mt-1"
                >
                  pick random
                </button>
              )}
            </div>
            <div>
              <div className="font-bold text-lg">{formatAmount(distance2, 3)}</div>
              <div className="opacity-60">2 hops</div>
              {visibleDistance2.length > 0 && (
                <button
                  onClick={() => pickRandom(visibleDistance2)}
                  className="text-[10px] link link-info mt-1"
                >
                  pick random
                </button>
              )}
            </div>
            <div>
              <div className="font-bold text-lg">{formatAmount(distance3Plus, 3)}</div>
              <div className="opacity-60">3+ hops</div>
              {visibleDistance3Plus.length > 0 && (
                <button
                  onClick={() => pickRandom(visibleDistance3Plus)}
                  className="text-[10px] link link-info mt-1"
                >
                  pick random
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </Widget>
  )
}
