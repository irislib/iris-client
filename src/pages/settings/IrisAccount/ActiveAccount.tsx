import AccountName from "./AccountName"
import {ndk} from "@/utils/ndk"

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
    const user = ndk().getUser({pubkey: myPub})
    user.profile = user.profile || {nip05}
    user.publish()
  }

  const onClick = async () => {
    const profile = ndk().getUser({pubkey: myPub}).profile
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
    <div>
      <div className="negative">
        You have an active iris.to username:
        <AccountName name={name} />
      </div>
      <p>
        <button className="btn btn-sm btn-primary" onClick={onClick}>
          Set as primary Nostr address (nip05)
        </button>
      </p>
    </div>
  )
}
