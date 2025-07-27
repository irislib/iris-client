import AccountName from "./AccountName"

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
    const user = {pubkey: myPub, profile: {nip05}}
    user.profile = user.profile || {nip05}
    // TODO: Implement profile saving with applesauce
    console.log("Saving profile:", user)
  }

  const onClick = async () => {
    const user = {pubkey: myPub, profile: {nip05: ""}}
    const profile = user.profile
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
