import UploadButton from "@/shared/components/button/UploadButton"
import useProfile from "@/shared/hooks/useProfile"
import {useEffect, useMemo, useState} from "react"
// import {getProfileContent} from "applesauce-core/helpers" // unused
import {useUserStore} from "@/stores/user"
import {Link} from "react-router"
import ProxyImg from "@/shared/components/ProxyImg"
import {publishEvent} from "@/utils/applesauce"

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
    return {pubkey: myPubKey, profile: existingProfile}
  }, [myPubKey, existingProfile])

  const [newProfile, setNewProfile] = useState<Record<string, string>>(
    (user?.profile as Record<string, string>) || {}
  )

  useEffect(() => {
    if (existingProfile) {
      setNewProfile(existingProfile as Record<string, string>)
    }
  }, [existingProfile])

  function setProfileField(field: string, value: string) {
    setNewProfile((prev: Record<string, string>) => {
      return {
        ...prev,
        [field]: value,
      }
    })
  }

  async function onSaveProfile() {
    if (!user || !newProfile) {
      return
    }

    try {
      // Merge new profile fields with existing profile to preserve all fields
      const mergedProfile = {
        ...existingProfile, // Start with existing profile
        ...newProfile, // Override with new values
      }

      // Remove any undefined or empty string values to clean up the profile
      const cleanedProfile = Object.fromEntries(
        Object.entries(mergedProfile).filter(
          ([, value]) => value !== undefined && value !== null && value !== ""
        )
      )

      // Create a profile event (kind 0) with the merged profile data
      const profileEvent = {
        kind: 0,
        content: JSON.stringify(cleanedProfile),
        tags: [],
        created_at: Math.floor(Date.now() / 1000),
      }

      console.log("Publishing profile update:", profileEvent)
      console.log("Merged profile:", cleanedProfile)
      await publishEvent(profileEvent)
      console.log("Profile updated successfully!")

      // Optionally show success message to user
      // You could add a toast notification here
    } catch (error) {
      console.error("Failed to update profile:", error)
      // Optionally show error message to user
    }
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
            <ProxyImg
              width={96}
              square={true}
              src={String(newProfile?.picture || existingProfile?.picture)}
              alt="Profile picture"
              className="w-24 h-24 rounded-full object-cover"
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
          <ProxyImg
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
