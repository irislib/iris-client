import {SettingsGroupItem} from "./SettingsGroupItem"

interface SettingToggleProps {
  checked: boolean
  onChange: () => void
  label: string
  disabled?: boolean
  isLast?: boolean
}

export function SettingToggle({
  checked,
  onChange,
  label,
  disabled = false,
  isLast = false,
}: SettingToggleProps) {
  return (
    <SettingsGroupItem isLast={isLast}>
      <div className="flex items-center justify-between">
        <span className={disabled ? "opacity-50" : ""}>{label}</span>
        <input
          type="checkbox"
          aria-label={label}
          checked={checked}
          onChange={onChange}
          disabled={disabled}
          className="toggle toggle-primary"
        />
      </div>
    </SettingsGroupItem>
  )
}
