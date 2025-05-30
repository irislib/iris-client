import {PublicKey} from "@/shared/utils/PublicKey"
import {useMemo, useState, useEffect} from "react"
import {Link, useNavigate} from "react-router"
import {useUserStore} from "@/stores/user"

import PublicKeyQRCodeButton from "@/shared/components/user/PublicKeyQRCodeButton"
import {FollowButton} from "@/shared/components/button/FollowButton.tsx"
import ProfileDetails from "@/pages/user/components/ProfileDetails.tsx"
import FollowerCount from "@/pages/user/components/FollowerCount.tsx"
import FollowsCount from "@/pages/user/components/FollowsCount.tsx"
import {PROFILE_AVATAR_WIDTH} from "@/shared/components/user/const"
import FollowedBy from "@/shared/components/user/FollowedBy"
import {Avatar} from "@/shared/components/user/Avatar.tsx"
import ProxyImg from "@/shared/components/ProxyImg.tsx"
import Header from "@/shared/components/header/Header"
import {Name} from "@/shared/components/user/Name.tsx"
import useProfile from "@/shared/hooks/useProfile.ts"
import Modal from "@/shared/components/ui/Modal.tsx"
import {useSessionsStore} from "@/stores/sessions"
import Icon from "@/shared/components/Icons/Icon"
import {Filter, VerifiedEvent} from "nostr-tools"
import {Invite} from "nostr-double-ratchet/src"
import {Helmet} from "react-helmet"
import {ndk} from "@/utils/ndk"

const ProfileHeader = ({pubKey}: {pubKey: string}) => {
  const profile = useProfile(pubKey, true)
  const pubKeyHex = useMemo(
    () => (pubKey ? new PublicKey(pubKey).toString() : ""),
    [pubKey]
  )
  const myPubKey = useUserStore((state) => state.publicKey)

  const [showProfilePhotoModal, setShowProfilePhotoModal] = useState(false)
  const [showBannerModal, setShowBannerModal] = useState(false)
  const [invite, setInvite] = useState<Invite | undefined>(undefined)

  const navigate = useNavigate()

  useEffect(() => {
    if (myPubKey === pubKeyHex) {
      return
    }

    const subscribe = (filter: Filter, onEvent: (event: VerifiedEvent) => void) => {
      const sub = ndk().subscribe(filter)
      sub.on("event", (e) => onEvent(e as unknown as VerifiedEvent))
      return () => sub.stop()
    }
    const unsub = Invite.fromUser(pubKeyHex, subscribe, (invite) => setInvite(invite))
    return unsub
  }, [myPubKey, pubKeyHex])

  return (
    <>
      <Header>
        <Name pubKey={pubKeyHex} />
      </Header>
      <div className="flex flex-col gap-4 w-full break-all">
        <div className="w-full h-48 md:h-72 bg-gradient-to-r from-primary to-primary-dark">
          {profile?.banner && (
            <ProxyImg
              src={profile?.banner}
              className="w-full h-48 md:h-72 object-cover cursor-pointer select-none"
              alt=""
              onClick={() => setShowBannerModal(true)}
              hideBroken={true}
              width={655}
            />
          )}
        </div>
        {showBannerModal && (
          <Modal onClose={() => setShowBannerModal(false)} hasBackground={false}>
            <ProxyImg
              src={String(profile?.banner)}
              className="max-h-screen max-w-screen"
              alt="Banner"
            />
          </Modal>
        )}
        <div className="flex flex-col gap-4 px-4 -mt-16">
          <div className="flex flex-row items-end gap-8 mt-4 justify-between select-none">
            <span
              onClick={() => profile?.picture && setShowProfilePhotoModal(true)}
              className="cursor-pointer"
            >
              <Avatar pubKey={pubKey} showBadge={false} width={PROFILE_AVATAR_WIDTH} />
            </span>
            {showProfilePhotoModal && (
              <Modal
                onClose={() => setShowProfilePhotoModal(false)}
                hasBackground={false}
              >
                <ProxyImg
                  src={String(profile?.picture)}
                  className="max-h-screen max-w-screen"
                  alt="Profile"
                />
              </Modal>
            )}

            <div className="flex flex-row gap-2" data-testid="profile-header-actions">
              {invite && myPubKey && (
                <button
                  className="btn btn-circle btn-neutral"
                  onClick={async () => {
                    if (!invite) return
                    const sessionId = await useSessionsStore
                      .getState()
                      .acceptInvite(invite.getUrl())
                    navigate("/chats/chat", {
                      state: {id: sessionId},
                    })
                  }}
                >
                  <Icon name="mail-outline" className="w-6 h-6" />
                </button>
              )}
              <PublicKeyQRCodeButton publicKey={pubKey} data-testid="profile-qr-button" />
              {myPubKey && myPubKey === pubKeyHex ? (
                <Link to="/settings/profile" className="btn btn-neutral">
                  Edit profile
                </Link>
              ) : (
                <FollowButton pubKey={pubKey} small={false} />
              )}
            </div>
          </div>
          <div className="text-2xl font-bold">
            <Name pubKey={pubKey} />
          </div>
          <ProfileDetails
            pubKey={pubKey}
            displayProfile={profile || undefined}
            externalIdentities={{github: ""}}
          />
        </div>
        <div className="flex flex-row gap-4 p-4 items-end flex-wrap">
          <FollowerCount pubKey={pubKeyHex} />
          <FollowsCount pubKey={pubKeyHex} />
        </div>
        {pubKeyHex !== myPubKey && (
          <div className="flex flex-row gap-4 px-4 mb-4 items-end flex-wrap">
            <FollowedBy pubkey={pubKeyHex} />
          </div>
        )}
        <Helmet>
          <title>
            {profile?.name ||
              profile?.display_name ||
              profile?.username ||
              profile?.nip05?.split("@")[0] ||
              "Profile"}{" "}
          </title>
        </Helmet>
      </div>
    </>
  )
}

export default ProfileHeader
