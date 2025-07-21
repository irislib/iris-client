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
            checked={content.showLikes}
            onChange={() => handleToggleChange("showLikes")}
            label="Show likes"
          />
          <SettingToggle
            checked={content.showReposts}
            onChange={() => handleToggleChange("showReposts")}
            label="Show reposts"
          />
          <SettingToggle
            checked={content.showReplies}
            onChange={() => handleToggleChange("showReplies")}
            label="Show replies"
          />
          <SettingToggle
            checked={content.showZaps}
            onChange={() => handleToggleChange("showZaps")}
            label="Show zaps"
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
}

function SettingToggle({checked, onChange, label}: SettingToggleProps) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        className="toggle toggle-primary"
      />
      <span>{label}</span>
    </div>
  )
}

export default Content
