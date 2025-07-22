import {UserRow} from "@/shared/components/user/UserRow"
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

  return (
    <div>
      <h1 className="text-2xl mb-4">Content</h1>
      <div className="space-y-4">
        <SettingToggle
          checked={content.hideEventsByUnknownUsers}
          onChange={() => handleToggleChange("hideEventsByUnknownUsers")}
          label="Hide posts by unknown users"
        />
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
        />
      </div>
      <div className="mt-6">
        <h2 className="text-xl mb-2">Reactions</h2>
        <div className="space-y-4">
          <SettingToggle
            checked={content.showReactionsBar}
            onChange={() => handleToggleChange("showReactionsBar")}
            label="Show reactions bar"
          />
          <SettingToggle
            checked={content.showReactionCounts}
            onChange={() => handleToggleChange("showReactionCounts")}
            label="Show reaction counts"
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
            disabled={!content.showReactionsBar}
          />
        </div>
      </div>
      <div className="mt-6">
        <h2 className="text-xl mb-2">Muted Users</h2>
        {mutes.length > 0 ? (
          <>
            <button
              onClick={() => setShowMutedUsers(!showMutedUsers)}
              className="mb-2 text-info link"
            >
              {showMutedUsers ? "Hide" : `Show muted users (${mutes.length})`}
            </button>
            {showMutedUsers && (
              <ul>
                {mutes.map((user, index) => (
                  <li className="mb-2" key={index}>
                    <UserRow pubKey={user} />
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : (
          <p>No muted users</p>
        )}
      </div>
    </div>
  )
}

interface SettingToggleProps {
  checked: boolean
  onChange: () => void
  label: string
  disabled?: boolean
}

function SettingToggle({checked, onChange, label, disabled = false}: SettingToggleProps) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        disabled={disabled}
        className="toggle toggle-primary"
      />
      <span className={disabled ? "opacity-50" : ""}>{label}</span>
    </div>
  )
}

export default Content
