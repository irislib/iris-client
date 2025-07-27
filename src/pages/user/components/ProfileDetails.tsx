import {RiErrorWarningLine, RiGithubFill, RiShieldCheckFill} from "@remixicon/react"
import {ElementType, ReactNode, useEffect, useMemo, useState} from "react"
import {useNip05Validation} from "@/shared/hooks/useNip05Validation"
import {useNavigate} from "react-router"
import {nip19} from "nostr-tools"

import {SubscriberBadge} from "@/shared/components/user/SubscriberBadge"
import HyperText from "@/shared/components/HyperText.tsx"
import MutedBy from "@/shared/components/user/MutedBy"
import Icon from "@/shared/components/Icons/Icon"
import {unmuteUser} from "@/shared/services/Mute"
import useMutes from "@/shared/hooks/useMutes"
import {Page404} from "@/pages/Page404"

const Bolt = () => <Icon name="zap-solid" className="text-accent" />
const Link = () => <Icon name="link-02" className="text-info" />

type ExternalIdentities = {
  github: string
}

interface ProfileDetailsProps {
  displayProfile: any | undefined
  externalIdentities: ExternalIdentities | undefined
  pubKey: string
}

function ProfileDetails({
  displayProfile,
  externalIdentities,
  pubKey,
}: ProfileDetailsProps) {
  const navigate = useNavigate()
  const [isValidPubkey, setIsValidPubkey] = useState(true)
  const nip05valid = useNip05Validation(pubKey, displayProfile?.nip05)

  const website = useMemo(() => {
    if (!displayProfile?.website) return null
    try {
      return new URL(displayProfile.website).toString()
    } catch {
      return null
    }
  }, [displayProfile])

  const {hexPub} = useMemo(() => {
    if (!pubKey) return {hexPub: ""}

    try {
      const hexPub = pubKey.startsWith("npub")
        ? String(nip19.decode(pubKey).data)
        : pubKey
      return {hexPub}
    } catch (error) {
      console.warn("Invalid pubkey:", error)
      setIsValidPubkey(false)
      return {hexPub: ""}
    }
  }, [pubKey])

  const mutes = useMutes(hexPub)
  const isMuted = useMemo(() => mutes.includes(hexPub), [mutes, hexPub])

  useEffect(() => {
    if (nip05valid && displayProfile?.nip05?.endsWith("@iris.to")) {
      const currentPath = window.location.pathname.split("/").slice(2).join("/")
      const basePath = displayProfile.nip05.replace("@iris.to", "")
      const newPath = currentPath ? `/${basePath}/${currentPath}` : `/${basePath}`

      if (window.location.pathname !== newPath) {
        navigate(newPath, {replace: true})
      }
    }
  }, [nip05valid, displayProfile?.nip05, navigate])

  const renderProfileField = (
    IconComponent: ElementType,
    content: string | ReactNode,
    key: string
  ) => (
    <div key={key} className="flex items-center gap-2">
      <IconComponent className="text-primary" />
      <small>{content}</small>
    </div>
  )

  if (!isValidPubkey) {
    return <Page404 />
  }

  return (
    <div className="flex flex-col gap-2">
      {isMuted && (
        <div className="flex items-center gap-2 text-warning">
          <RiErrorWarningLine className="text-warning" />
          <small>User is muted</small>
          <button className="btn btn-sm btn-neutral" onClick={() => unmuteUser(hexPub)}>
            Unmute
          </button>
        </div>
      )}
      <MutedBy pubkey={hexPub} />
      <SubscriberBadge className="mb-1" pubkey={hexPub} />
      {displayProfile?.nip05 && (
        <div>
          {renderProfileField(
            (() => {
              if (nip05valid === null) return RiShieldCheckFill
              return nip05valid ? RiShieldCheckFill : RiErrorWarningLine
            })(),
            (() => {
              const displayName = displayProfile.nip05.replace("_@", "")
              if (nip05valid === null) return displayName
              return nip05valid ? displayName : <s>{displayName}</s>
            })(),
            "nip05"
          )}
        </div>
      )}
      {website &&
        renderProfileField(
          Link,
          <a href={website} target="_blank" className="link" rel="noreferrer">
            {website.replace(/https?:\/\//, "").replace(/\/$/, "")}
          </a>,
          "website"
        )}
      {externalIdentities?.github &&
        renderProfileField(RiGithubFill, externalIdentities.github, "github")}
      {displayProfile?.lud16 &&
        renderProfileField(
          Bolt,
          <a href={`lightning:${displayProfile.lud16}`} className="link">
            {displayProfile.lud16}
          </a>,
          "lud16"
        )}
      {displayProfile?.about && (
        <article className="prose">
          <HyperText small={true} truncate={100}>
            {displayProfile.about}
          </HyperText>
        </article>
      )}
    </div>
  )
}

export default ProfileDetails
