import {useState} from "react"
import {buildProfileDraft} from "@iris/profile-events"
import {AppEvent} from "@/lib/nostr"
import {readProfileMetadata} from "../profileMetadata"
import {updateProfileFromEvent} from "@/shared/hooks/useProfile"
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
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const onClick = async () => {
    setSaving(true)
    setError("")
    try {
      const client = nostr()
      const latest = await client.fetchEvent({kinds: [0], authors: [myPub]})
      const source = readProfileMetadata(JSON.stringify(latest?.rawEvent()), myPub)
      if (!source)
        throw Error(
          "Load your public profile in Profile settings before changing its address."
        )
      const signer = client.signer
      if (!signer || (await signer.user()).pubkey !== myPub)
        throw Error("Sign in to change your address.")
      const nip05 = name + "@iris.to"
      if (source.metadata.nip05 !== nip05) {
        const event = new AppEvent(client, buildProfileDraft(source.event, {nip05}))
        await event.sign(signer, {preserveTags: true})
        await event.publish()
        updateProfileFromEvent(event)
      }
      setAsPrimary()
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not change your primary address."
      )
    } finally {
      setSaving(false)
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
        <button className="btn btn-sm btn-primary" onClick={onClick} disabled={saving}>
          Set as primary Nostr address (nip05)
        </button>
        {error && <p role="alert">{error}</p>}
      </SettingsGroupItem>
    </SettingsGroup>
  )
}
