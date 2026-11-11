import {TranslatableText} from "@/shared/components/Translation"
import useProfile from "@/shared/hooks/useProfile.ts"

export function ProfileAbout({pubKey, className}: {pubKey: string; className?: string}) {
  const profile = useProfile(pubKey)

  if (profile?.about) {
    return (
      <div className={className}>
        <TranslatableText small={true} expandable={false} truncate={100}>
          {profile.about}
        </TranslatableText>
      </div>
    )
  }

  return ""
}
