import useProfile from "@/shared/hooks/useProfile.ts"
import HyperText from "../HyperText"

export function ProfileAbout({pubKey, className}: {pubKey: string; className?: string}) {
  const profile = useProfile(pubKey)

  if (profile?.about) {
    return (
      <div className={className}>
        <HyperText small={true} expandable={false} truncate={100}>
          {String(profile.about)}
        </HyperText>
      </div>
    )
  }

  return ""
}
