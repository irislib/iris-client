import {withRecoveryMount} from "@/navigation/recoveryMount"
import {Fragment} from "react"

import {AvatarGroup} from "@/shared/components/user/AvatarGroup"
import {Name} from "@/shared/components/user/Name"
import {ProfileLink} from "@/shared/components/user/ProfileLink"

interface DonationCheckboxProps {
  zapDonationEnabled: boolean
  setZapDonationEnabled: (enabled: boolean) => void
  zapDonationRecipients: Array<{recipient: string; percentage: number}>
  donationPubkeys: string[]
  recipientNames: string[]
  totalDonationAmount: number
}

export function DonationCheckbox({
  zapDonationEnabled,
  setZapDonationEnabled,
  zapDonationRecipients,
  donationPubkeys,
  recipientNames,
  totalDonationAmount,
}: DonationCheckboxProps) {
  return (
    <label className="label cursor-pointer justify-start gap-2">
      <input
        type="checkbox"
        className="checkbox"
        checked={zapDonationEnabled}
        onChange={(e) => setZapDonationEnabled(e.target.checked)}
        disabled={zapDonationRecipients.length === 0}
      />
      <div className="flex flex-col gap-1">
        {zapDonationRecipients.length > 0 ? (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="label-text">Donate {totalDonationAmount} bits to</span>
            {donationPubkeys.length > 0 && (
              <AvatarGroup pubKeys={donationPubkeys.slice(0, 3)} avatarWidth={20} />
            )}
            <span className="label-text text-xs">
              {recipientNames.slice(0, 3).map((name, index) => (
                <Fragment key={name}>
                  {name.startsWith("npub") ? (
                    <ProfileLink
                      pubKey={donationPubkeys[index] || name}
                      className="link inline"
                    >
                      <Name pubKey={donationPubkeys[index] || name} />
                    </ProfileLink>
                  ) : (
                    <span>{name}</span>
                  )}
                  {index < Math.min(recipientNames.length, 3) - 1 && ", "}
                </Fragment>
              ))}
              {recipientNames.length > 3 && ` and ${recipientNames.length - 3} others`}
            </span>
            <a href={withRecoveryMount("/settings/wallet")} className="link text-xs">
              (configure)
            </a>
          </div>
        ) : (
          <span className="label-text">Donate</span>
        )}
      </div>
    </label>
  )
}
