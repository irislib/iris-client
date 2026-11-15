import {SettingsGroup} from "@/shared/components/settings/SettingsGroup"
import {SettingsGroupItem} from "@/shared/components/settings/SettingsGroupItem"
import {useSettingsStore} from "@/stores/settings"

function AppearanceSettings() {
  const {appearance, updateAppearance} = useSettingsStore()

  return (
    <div className="bg-base-200 min-h-full">
      <div className="p-4">
        <div className="space-y-6">
          <SettingsGroup title="Theme">
            <SettingsGroupItem isLast>
              <div className="flex justify-between items-center">
                <span>Color scheme</span>
                <select
                  className="select select-sm bg-base-200 border-base-content/20"
                  value={appearance.theme}
                  onChange={(e) => updateAppearance({theme: e.target.value})}
                >
                  <option value="light">Light</option>
                  <option value="dark">Dark</option>
                  <option value="night">Night</option>
                  <option value="system">System</option>
                </select>
              </div>
            </SettingsGroupItem>
          </SettingsGroup>

          <SettingsGroup title="Layout">
            <SettingsGroupItem isLast>
              <div className="flex justify-between items-center">
                <div className="flex flex-col">
                  <span>Limited maximum width</span>
                  <span className="text-sm text-base-content/60">
                    Constrain content width for better readability
                  </span>
                </div>
                <input
                  type="checkbox"
                  className="toggle toggle-primary"
                  checked={appearance.limitedMaxWidth}
                  onChange={(e) => updateAppearance({limitedMaxWidth: e.target.checked})}
                />
              </div>
            </SettingsGroupItem>
          </SettingsGroup>
        </div>
      </div>
    </div>
  )
}

export default AppearanceSettings
