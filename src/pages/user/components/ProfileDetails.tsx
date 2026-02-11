import {RiErrorWarningLine, RiGithubFill} from "@remixicon/react"
import {ElementType, ReactNode, useEffect, useMemo, useRef, useState} from "react"
import {NDKUserProfile} from "@/lib/ndk"
import {useNavigate} from "@/navigation"
import {useIsTopOfStack} from "@/navigation/useIsTopOfStack"
import {nip05, nip19} from "nostr-tools"

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
  displayProfile: NDKUserProfile | undefined
  externalIdentities: ExternalIdentities | undefined
  pubKey: string
}

function ProfileDetails({
  displayProfile,
  externalIdentities,
  pubKey,
}: ProfileDetailsProps) {
  const navigate = useNavigate()
  const isTopOfStack = useIsTopOfStack()
  const [isValidPubkey, setIsValidPubkey] = useState(true)
  const hasRedirectedRef = useRef(false)

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

  // Reset redirect flag when pubkey changes
  useEffect(() => {
    hasRedirectedRef.current = false
  }, [pubKey])

  useEffect(() => {
    if (!isTopOfStack) return
    if (hasRedirectedRef.current) return

    if (
      displayProfile?.nip05?.endsWith("@iris.to") &&
      displayProfile.nip05 !== "_@iris.to"
    ) {
      const currentPath = window.location.pathname.split("/").slice(2).join("/")
      const basePath = displayProfile.nip05.replace("@iris.to", "")
      const newPath = currentPath ? `/${basePath}/${currentPath}` : `/${basePath}`

      if (window.location.pathname !== newPath) {
        // Verify NIP-05 resolves before redirecting to username URL
        nip05
          .queryProfile(displayProfile.nip05)
          .then((resolved) => {
            if (resolved && !hasRedirectedRef.current) {
              hasRedirectedRef.current = true
              navigate(newPath, {replace: true})
            }
          })
          .catch(() => {})
      }
    }
  }, [isTopOfStack, displayProfile?.nip05, navigate, pubKey])

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
            {displayProfile.lud16.length > 30
              ? `${displayProfile.lud16.slice(0, 15)}...${displayProfile.lud16.slice(-15)}`
              : displayProfile.lud16}
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
