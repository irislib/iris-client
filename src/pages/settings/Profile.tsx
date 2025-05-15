import UploadButton from "@/shared/components/button/UploadButton"
import {useUserStore} from "@/stores/user"
import useProfile from "@/shared/hooks/useProfile"
import {useEffect, useMemo, useState} from "react"
import {NDKUserProfile} from "@nostr-dev-kit/ndk"
import {Link} from "react-router"
import {ndk} from "@/utils/ndk"

export function ProfileSettings() {
  const [publicKeyState, setPublicKeyState] = useState("")
  const myPubKey = useUserStore((state) => state.publicKey)
  
  useEffect(() => {
    if (myPubKey) {
      setPublicKeyState(myPubKey)
    }
  }, [myPubKey])
  
  const existingProfile = useProfile(publicKeyState)

  const user = useMemo(() => {
    if (!myPubKey) {
      return null
    }
    return ndk().getUser({pubkey: myPubKey})
  }, [myPubKey])

  const [newProfile, setNewProfile] = useState<NDKUserProfile>(user?.profile || {})

  useEffect(() => {
    if (existingProfile) {
      setNewProfile(existingProfile)
    }
  }, [existingProfile])

  function setProfileField(field: keyof NDKUserProfile, value: string) {
    setNewProfile((prev) => {
      return {
        ...prev,
        [field]: value,
      }
    })
  }

  function onSaveProfile() {
    if (!user || !newProfile) {
      return
    }
    user.profile = newProfile
    user.publish()
  }

  const isEdited = useMemo(() => {
    if (!newProfile) {
      return false
    }
    return JSON.stringify(newProfile) !== JSON.stringify(existingProfile)
  }, [newProfile, existingProfile])

  if (!myPubKey) {
    return null
  }

  return (
    <div className="mb-4">
      <h2 className="text-2xl mb-4">Profile</h2>
      <div className="flex flex-col gap-4">
        <label className="form-control w-full max-w-xs">
          <div className="label">
            <span className="label-text">Name</span>
          </div>
          <input
            type="text"
            placeholder="Name"
            className="input input-bordered w-full max-w-xs"
            value={newProfile?.display_name}
            onChange={(e) => setProfileField("display_name", e.target.value)}
          />
        </label>
        {newProfile?.picture && (
          <div className="flex items-center gap-4 my-4">
            <img
              src={String(newProfile?.picture || existingProfile?.picture)}
              className="w-24 h-24 rounded-full"
              alt="Profile picture"
            />
          </div>
        )}
        <label className="form-control w-full max-w-xs">
          <div className="label">
            <span className="label-text">Image</span>
          </div>
          <input
            type="text"
            placeholder="Image"
            className="input input-bordered w-full max-w-xs mb-4"
            value={newProfile?.picture}
            onChange={(e) => setProfileField("picture", e.target.value)}
          />
          <UploadButton
            text="Upload new"
            onUpload={(url) => setProfileField("picture", url)}
          />
        </label>
        {newProfile?.banner && (
          <img
            src={newProfile?.banner}
            alt="Banner"
            className="w-full h-48 object-cover"
          />
        )}
        <label className="form-control w-full max-w-xs">
          <div className="label">
            <span className="label-text">Banner</span>
          </div>
          <input
            type="text"
            placeholder="Image"
            className="input input-bordered w-full max-w-xs mb-4"
            value={newProfile?.banner}
            onChange={(e) => setProfileField("banner", e.target.value)}
          />
          <UploadButton
            text="Upload new"
            onUpload={(url) => setProfileField("banner", url)}
          />
        </label>
        <label className="form-control w-full max-w-xs">
          <div className="label">
            <span className="label-text">Lightning address</span>
          </div>
          <input
            type="text"
            placeholder="Lightning address"
            className="input input-bordered w-full max-w-xs"
            value={newProfile?.lud16}
            onChange={(e) => setProfileField("lud16", e.target.value)}
          />
        </label>
        <label className="form-control w-full max-w-xs">
          <div className="label">
            <span className="label-text">Website</span>
          </div>
          <input
            type="text"
            placeholder="Website"
            className="input input-bordered w-full max-w-xs"
            value={newProfile?.website}
            onChange={(e) => setProfileField("website", e.target.value)}
          />
        </label>
        <label className="form-control w-full max-w-xs">
          <div className="label">
            <span className="label-text">
              User @ domain name verification (
              <a
                href="https://nostr.how/en/guides/get-verified"
                target="_blank"
                rel="noreferrer"
                className="link"
              >
                NIP-05
              </a>
              )
            </span>
          </div>
          <input
            type="text"
            placeholder="user@example.com"
            className="input input-bordered w-full max-w-xs"
            value={newProfile?.nip05}
            onChange={(e) => setProfileField("nip05", e.target.value)}
          />
          <div className="mt-2">
            <Link to="/settings/iris" className="link hover:underline">
              Get free username @ iris.to
            </Link>
          </div>
        </label>
        <label className="form-control w-full max-w-xs">
          <div className="label">
            <span className="label-text">About</span>
          </div>
          <textarea
            placeholder="About"
            className="textarea textarea-bordered w-full max-w-xs"
            value={newProfile?.about}
            onChange={(e) => setProfileField("about", e.target.value)}
          />
        </label>
        <button className="btn btn-primary" onClick={onSaveProfile} disabled={!isEdited}>
          Save
        </button>
      </div>
    </div>
  )
}
