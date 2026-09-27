import {UserRow} from "@/shared/components/user/UserRow"
import {SettingsGroup} from "@/shared/components/settings/SettingsGroup"
import {SettingsGroupItem} from "@/shared/components/settings/SettingsGroupItem"
import {SettingToggle} from "@/shared/components/settings/SettingToggle"
import {useSettingsStore} from "@/stores/settings"
import useMutes from "@/shared/hooks/useMutes"
import {useState} from "react"

function Content() {
  const {content, updateContent} = useSettingsStore()
  const mutes = useMutes()
  const [showMutedUsers, setShowMutedUsers] = useState<boolean>(false)

  const handleToggleChange = (key: keyof typeof content) => {
    updateContent({[key]: !content[key]})
  }

  const handleFollowDistanceChange = (value: number) => {
    // Map slider value 6 to undefined (unlimited)
    const filterValue = value === 6 ? undefined : value
    updateContent({maxFollowDistanceForReplies: filterValue})
  }

  const getFollowDistanceLabel = (value: number | undefined) => {
    if (value === undefined || value === 6) return "Unlimited"
    if (value === 1) return "Followed users only"
    if (value === 2) return "Followed by friends"
    if (value >= 3 && value <= 5) return `Follow distance ${value}`
    return `Follow distance ${value}`
  }

  return (
    <div className="bg-base-200 min-h-full">
      <div className="p-4">
        <div className="space-y-6">
          <SettingsGroup title="Publishing">
            <SettingToggle
              checked={content.showClientTag}
              onChange={() => handleToggleChange("showClientTag")}
              label="Show Iris on my public activity"
              isLast
            />
          </SettingsGroup>
          <SettingsGroup>
            <SettingsGroupItem>
              <div className="w-full">
                <div className="flex justify-between items-center mb-2">
                  <label className="text-base font-medium">
                    Show replies and reactions from follow distance
                  </label>
                  <span className="text-sm text-base-content/70">
                    {getFollowDistanceLabel(content.maxFollowDistanceForReplies)}
                  </span>
                </div>
                <input
                  type="range"
                  min="1"
                  max="6"
                  value={content.maxFollowDistanceForReplies ?? 6}
                  onChange={(e) => handleFollowDistanceChange(Number(e.target.value))}
                  className="range range-sm w-full"
                  step="1"
                />
                <div className="text-xs text-base-content/50 mt-1">
                  1 = Followed users • 2 = Friends of friends • 3-5 = Extended network •
                  Unlimited = No filter
                </div>
              </div>
            </SettingsGroupItem>
            <SettingToggle
              checked={content.blurNSFW}
              onChange={() => handleToggleChange("blurNSFW")}
              label="Blur NSFW Media"
            />
            <SettingToggle
              checked={content.hidePostsByMutedMoreThanFollowed}
              onChange={() => handleToggleChange("hidePostsByMutedMoreThanFollowed")}
              label="Hide posts by users who are muted more than followed"
            />
            <SettingToggle
              checked={content.autoplayVideos}
              onChange={() => handleToggleChange("autoplayVideos")}
              label="Autoplay videos"
              isLast
            />
          </SettingsGroup>

          <SettingsGroup title="Reactions">
            <SettingToggle
              checked={content.showReactionsBar}
              onChange={() => handleToggleChange("showReactionsBar")}
              label="Show reactions bar"
            />
            <SettingToggle
              checked={content.showReactionCounts}
              onChange={() => handleToggleChange("showReactionCounts")}
              label="Show reaction counts in feed"
            />
            <SettingToggle
              checked={content.showReactionCountsInStandalone}
              onChange={() => handleToggleChange("showReactionCountsInStandalone")}
              label="Show reaction counts in post view"
            />
            <SettingToggle
              checked={!content.hideReactionsBarInStandalone}
              onChange={() => handleToggleChange("hideReactionsBarInStandalone")}
              label="Show reactions bar in standalone posts"
              disabled={!content.showReactionsBar || !content.showLikes}
            />
            <SettingToggle
              checked={!content.hideZapsBarInStandalone}
              onChange={() => handleToggleChange("hideZapsBarInStandalone")}
              label="Show zaps bar in standalone posts"
              disabled={!content.showReactionsBar || !content.showZaps}
            />
            <SettingToggle
              checked={content.showLikes}
              onChange={() => handleToggleChange("showLikes")}
              label="Show likes"
              disabled={!content.showReactionsBar}
            />
            <SettingToggle
              checked={content.showReposts}
              onChange={() => handleToggleChange("showReposts")}
              label="Show reposts"
              disabled={!content.showReactionsBar}
            />
            <SettingToggle
              checked={content.showReplies}
              onChange={() => handleToggleChange("showReplies")}
              label="Show replies"
              disabled={!content.showReactionsBar}
            />
            <SettingToggle
              checked={content.showZaps}
              onChange={() => handleToggleChange("showZaps")}
              label="Show zaps"
              isLast
              disabled={!content.showReactionsBar}
            />
          </SettingsGroup>

          <SettingsGroup title="Muted Users">
            {mutes.length > 0 ? (
              <>
                <SettingsGroupItem
                  onClick={() => setShowMutedUsers(!showMutedUsers)}
                  className="text-info"
                  isLast={!showMutedUsers}
                >
                  {showMutedUsers ? "Hide" : `Show muted users (${mutes.length})`}
                </SettingsGroupItem>
                {showMutedUsers &&
                  mutes.map((user, index) => (
                    <SettingsGroupItem key={index} isLast={index === mutes.length - 1}>
                      <UserRow pubKey={user} />
                    </SettingsGroupItem>
                  ))}
              </>
            ) : (
              <SettingsGroupItem isLast className="text-base-content/70">
                No muted users
              </SettingsGroupItem>
            )}
          </SettingsGroup>
        </div>
      </div>
    </div>
  )
}

export default Content
