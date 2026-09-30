import {createContext, useContext, useMemo, type ReactNode} from "react"
import type {AppEvent} from "@/lib/nostr"
import {Link} from "@/navigation"
import {groupAddress, type GroupRef} from "./model"
import {groupPath, useGroup, type GroupAccess} from "./useGroup"
import {getEventGroup} from "./activity"
export {getEventGroup} from "./activity"

const GroupContext = createContext<GroupAccess | null>(null)
export const useGroupAccess = () => useContext(GroupContext)
export const GroupProvider = GroupContext.Provider

export function useGroupVisibility() {
  const access = useGroupAccess()
  return useMemo(
    () =>
      access
        ? {
            shouldHideRecommendationUser: (pubkey: string) =>
              !access.membership?.authorityPubkeys.has(pubkey),
            shouldHideAlgorithmicEvent: (event: {pubkey: string; tags: string[][]}) => {
              const ref = getEventGroup(event)
              return (
                !ref ||
                groupAddress(ref) !== groupAddress(access.ref) ||
                !access.isVisibleMember(event.pubkey)
              )
            },
          }
        : null,
    [access]
  )
}

function ResolvedGroupScope({group, children}: {group: GroupRef; children: ReactNode}) {
  const access = useGroup(group)
  return (
    <GroupProvider value={access}>
      <Link
        to={groupPath(group)}
        className="block px-4 pt-3 text-sm text-primary"
        onClick={(event) => event.stopPropagation()}
      >
        {access.group?.name || "View group"}
      </Link>
      {children}
    </GroupProvider>
  )
}

/** Direct post links, profile feeds and embeds preserve the same participation rules. */
export function GroupEventScope({
  event,
  children,
}: {
  event?: AppEvent
  children: ReactNode
}) {
  const parent = useGroupAccess()
  const group = getEventGroup(event)
  if (!group || (parent && groupAddress(parent.ref) === groupAddress(group)))
    return <>{children}</>
  return <ResolvedGroupScope group={group}>{children}</ResolvedGroupScope>
}
