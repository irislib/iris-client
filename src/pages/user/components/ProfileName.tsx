import {RiVerifiedBadgeLine, RiErrorWarningLine} from "@remixicon/react"
import {useNip05Validation} from "@/shared/hooks/useNip05Validation"
import {NDKUserProfile} from "@nostr-dev-kit/ndk"
import {useNavigate} from "react-router"
import {useCallback} from "react"

interface ProfileNameProps {
  profile?: NDKUserProfile
  pubkey: string
}

function ProfileName({profile, pubkey}: ProfileNameProps) {
  const navigate = useNavigate()
  const nip05valid = useNip05Validation(pubkey, profile?.nip05)

  const handleClick = useCallback(() => navigate(`/${pubkey}`), [pubkey])

  return (
    <div className="ProfileItem-text-container cursor-pointer" onClick={handleClick}>
      <span className="ProfileName-names-row">
        {profile?.name && <span>{profile.name}</span>}
        {profile?.name && profile?.displayName && (
          <span className="greytext">{profile?.displayName}</span>
        )}
        {!profile?.name && profile?.displayName && <span>{profile?.displayName}</span>}
      </span>
      {!profile?.name && !profile?.displayName && <span>Anonymous Nostrich</span>}
      {profile?.nip05 && (
        <span className="ProfileName-nip05">
          {nip05valid ? (
            <RiVerifiedBadgeLine className="ProfileName-nip05-icon" />
          ) : (
            <RiErrorWarningLine className="ProfileName-nip05-icon" />
          )}
          <small className="ProfileName-nip05-text">{profile?.nip05}</small>
        </span>
      )}
    </div>
  )
}

export default ProfileName
