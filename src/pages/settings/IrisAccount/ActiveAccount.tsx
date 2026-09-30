import AccountName from "./AccountName"
import {nostr} from "@/utils/nostrClient"
import {SettingsGroup} from "@/shared/components/settings/SettingsGroup"
import {SettingsGroupItem} from "@/shared/components/settings/SettingsGroupItem"

interface ActiveAccountProps {
  name?: string
  setAsPrimary: () => void
  myPub?: string
}

export default function ActiveAccount({
  name = "",
  setAsPrimary = () => {},
  myPub = "",
}: ActiveAccountProps) {
  async function saveProfile(nip05: string) {
    const user = nostr().getUser({pubkey: myPub})
    user.profile = user.profile || {nip05}
    user.publish()
  }

  const onClick = async () => {
    const profile = nostr().getUser({pubkey: myPub}).profile
    const newNip = name + "@iris.to"
    const timeout = setTimeout(() => {
      saveProfile(newNip)
    }, 2000)
    if (profile) {
      clearTimeout(timeout)
      if (profile.nip05 !== newNip) {
        saveProfile(newNip)
        setAsPrimary()
      }
    }
  }

  return (
    <SettingsGroup title="Active Iris.to Username">
      <SettingsGroupItem>
        <div className="text-sm text-base-content/70 mb-3">
          You have an active iris.to username:
        </div>
      </SettingsGroupItem>
      <AccountName name={name} />
      <SettingsGroupItem>
        <button className="btn btn-sm btn-primary" onClick={onClick}>
          Set as primary Nostr address (nip05)
        </button>
      </SettingsGroupItem>
    </SettingsGroup>
  )
}
