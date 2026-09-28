import {Avatar} from "@/shared/components/user/Avatar"
import {Name} from "@/shared/components/user/Name"
import {ProfileLink} from "@/shared/components/user/ProfileLink"
import type {GroupMember} from "../model"

export default function GroupMemberRow({
  member,
  publicKey,
  creator,
  busy,
  onConfirm,
}: {
  member: GroupMember
  publicKey: string
  creator: string
  busy: string
  onConfirm?: (member: GroupMember) => void
}) {
  return (
    <div
      className="flex flex-wrap items-start gap-3 py-4"
      data-testid="group-member"
      data-pubkey={member.pubkey}
    >
      <ProfileLink pubKey={member.pubkey}>
        <Avatar pubKey={member.pubkey} width={42} />
      </ProfileLink>
      <div className="min-w-0 flex-1 basis-32">
        <ProfileLink pubKey={member.pubkey}>
          <Name pubKey={member.pubkey} className="font-semibold break-words" />
        </ProfileLink>
        <p className="text-sm text-base-content/55 mt-1">
          {member.pubkey === creator
            ? "Group creator"
            : member.eligible
              ? "Member"
              : "Awaiting confirmation"}
        </p>
        {member.directVouches + member.secondDegreeVouches > 0 && (
          <details className="text-xs mt-2 text-base-content/55">
            <summary className="cursor-pointer">Confirmations</summary>
            <div className="flex flex-wrap gap-2 pt-2">
              {member.vouchers.slice(0, 20).map((key) => (
                <ProfileLink key={key} pubKey={key}>
                  <Name pubKey={key} />
                </ProfileLink>
              ))}
            </div>
          </details>
        )}
      </div>
      {onConfirm && member.pubkey !== publicKey && (
        <button
          disabled={!!busy}
          className="btn btn-ghost btn-sm shrink-0 ml-auto"
          onClick={() => onConfirm(member)}
        >
          {busy === member.pubkey
            ? "Saving…"
            : member.vouchers.includes(publicKey)
              ? "Withdraw confirmation"
              : "Confirm membership"}
        </button>
      )}
    </div>
  )
}
