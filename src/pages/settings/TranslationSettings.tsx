import {useEffect, useState} from "react"
import {
  languageChoices,
  onPreferences,
  preferences,
  supported,
  updatePreferences,
} from "@/lib/translation"
import {SettingsGroup} from "@/shared/components/settings/SettingsGroup"
import {SettingsGroupItem} from "@/shared/components/settings/SettingsGroupItem"
import {SettingToggle} from "@/shared/components/settings/SettingToggle"

export function TranslationSettings() {
  const [prefs, setPrefs] = useState(preferences)
  useEffect(() => onPreferences(() => setPrefs(preferences())), [])
  if (!supported) return null
  const choices = languageChoices(prefs)
  return (
    <SettingsGroup title="Translation">
      <SettingToggle
        checked={prefs.auto}
        onChange={() => updatePreferences({auto: !prefs.auto})}
        label="Automatically translate when reading"
      />
      <SettingsGroupItem>
        <label className="flex items-center justify-between gap-3 w-full">
          Translate into
          <select
            className="select select-bordered select-sm"
            value={prefs.target}
            onChange={(e) => updatePreferences({target: e.target.value})}
          >
            {choices.map(({code, name}) => (
              <option key={code} value={code}>
                {name}
              </option>
            ))}
          </select>
        </label>
      </SettingsGroupItem>
      <SettingsGroupItem isLast>
        <div className="w-full">
          <label className="flex items-center justify-between gap-3">
            Languages I read
            <select
              className="select select-bordered select-sm"
              value=""
              onChange={(e) => updatePreferences({read: [...prefs.read, e.target.value]})}
            >
              <option value="">Add a language…</option>
              {choices
                .filter(({code}) => code !== prefs.target && !prefs.read.includes(code))
                .map(({code, name}) => (
                  <option key={code} value={code}>
                    {name}
                  </option>
                ))}
            </select>
          </label>
          {prefs.read.map((code) => {
            const name = choices.find((item) => item.code === code)?.name
            return (
              <button
                key={code}
                className="btn btn-xs mt-2 mr-2"
                aria-label={"Remove " + name}
                onClick={() =>
                  updatePreferences({read: prefs.read.filter((item) => item !== code)})
                }
              >
                {name} ×
              </button>
            )
          })}
        </div>
      </SettingsGroupItem>
    </SettingsGroup>
  )
}
