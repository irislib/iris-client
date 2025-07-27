import {RiVerifiedBadgeLine, RiErrorWarningLine} from "@remixicon/react"
import {useNip05Validation} from "@/shared/hooks/useNip05Validation"
import {Navigate} from "@/shared/components/Navigate"

interface ProfileNameProps {
  profile?: any
  pubkey: string
}

function ProfileName({profile, pubkey}: ProfileNameProps) {
  const nip05valid = useNip05Validation(pubkey, profile?.nip05)

  return (
    <Navigate className="ProfileItem-text-container" to={`/${pubkey}`}>
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
            <>
              <RiVerifiedBadgeLine className="verified" />
              <span className="verified">{profile.nip05}</span>
            </>
          ) : (
            <>
              <RiErrorWarningLine className="not-verified" />
              <span className="not-verified">{profile.nip05}</span>
            </>
          )}
        </span>
      )}
    </Navigate>
  )
}

export default ProfileName
