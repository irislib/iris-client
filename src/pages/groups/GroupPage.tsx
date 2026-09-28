import {useMemo, useRef, useState} from "react"
import {RiBarChartFill, RiLink, RiSettings3Fill} from "@remixicon/react"
import {useParams, Link} from "@/navigation"
import {usePublicKey} from "@/stores/user"
import {useUIStore} from "@/stores/ui"
import {useToastStore} from "@/stores/toast"
import Header from "@/shared/components/header/Header"
import {ScrollablePageContainer} from "@/shared/components/layout/ScrollablePageContainer"
import {Avatar} from "@/shared/components/user/Avatar"
import {Name} from "@/shared/components/user/Name"
import {ProfileLink} from "@/shared/components/user/ProfileLink"
import Feed from "@/shared/components/feed/Feed"
import {BaseNoteCreator} from "@/shared/components/notes/BaseNoteCreator"
import {type NDKEvent} from "@/lib/ndk"
import {
  createMembershipDraft,
  createMembershipAttestationDraft,
  groupAddress,
  type GroupRef,
} from "@/groups/model"
import {GroupProvider} from "@/groups/GroupContext"
import {groupPath, useGroup, type GroupView} from "@/groups/useGroup"
import {publishGroupEvent} from "@/groups/publish"
import {useSavedGroups} from "@/groups/savedGroups"
import GroupForm from "@/groups/components/GroupForm"
import GroupSettings from "@/groups/components/GroupSettings"
import PollCreator from "@/groups/components/PollCreator"
import {useGroupFeed} from "@/groups/useGroupFeed"
import {diversifyGroupFeed} from "@/groups/groupFeed"

export default function GroupPage() {
  const {owner, groupId} = useParams()
  if (
    !/^[0-9a-f]{64}$/.test(owner ?? "") ||
    !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(groupId ?? "")
  ) {
    return (
      <div className="p-8">
        <h1 className="text-xl font-semibold">Invalid group link</h1>
        <Link className="link" to="/groups">
          Browse groups
        </Link>
      </div>
    )
  }
  return (
    <GroupContent key={`${owner}:${groupId}`} reference={{id: groupId, creator: owner}} />
  )
}

function GroupContent({reference}: {reference: GroupRef}) {
  const publicKey = usePublicKey()
  const [tab, setTab] = useState<"posts" | "polls" | "members">("posts")
  const [view, setView] = useState<GroupView>("creator")
  const access = useGroup(reference, view)
  const {group, membership, canParticipate} = access
  const me = membership?.byPubkey.get(publicKey)
  const [editing, setEditing] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [polling, setPolling] = useState(false)
  const [busy, setBusy] = useState("")
  const actionPending = useRef(false)
  const [error, setError] = useState("")
  const [injected, setInjected] = useState<NDKEvent[]>([])
  const [memberQuery, setMemberQuery] = useState("")
  const [memberLimit, setMemberLimit] = useState(50)
  const feed = useGroupFeed(access, publicKey, "trusted", tab === "polls", injected)
  const address = groupAddress(reference)
  const feedConfig = useMemo(
    () => ({
      id: `group:${address}:${view}:${tab}`,
      name: group?.name ?? "Group",
      filter: {
        kinds: tab === "polls" ? [1068] : [1, 1068],
        "#h": [reference.id],
        "#a": [address],
        limit: 50,
      },
      hideReplies: true,
      sortType: "chronological" as const,
      autoShowNewEvents: true,
      showRepliedTo: false,
      showEventsByUnknownUsers: false,
    }),
    [address, view, tab, group?.name, reference.id]
  )
  const action = async (key: string, draft: ReturnType<typeof createMembershipDraft>) => {
    if (actionPending.current) return
    actionPending.current = true
    setBusy(key)
    setError("")
    try {
      await publishGroupEvent(draft)
      useSavedGroups.getState().remember(publicKey, reference)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save. Try again.")
    } finally {
      actionPending.current = false
      setBusy("")
    }
  }
  const join = () => {
    if (!publicKey) return useUIStore.getState().setShowLoginDialog(true)
    action("membership", createMembershipDraft(reference, publicKey, !me?.joined))
  }
  const share = async () => {
    try {
      await navigator.clipboard.writeText(
        new URL(groupPath(reference), window.location.origin).href
      )
      useToastStore.getState().addToast("Group link copied", "success")
    } catch {
      setError("Could not copy the link. You can copy it from your address bar.")
    }
  }
  const members =
    membership?.members.filter(
      (member) =>
        member.joined &&
        (!memberQuery || member.pubkey.includes(memberQuery.toLowerCase()))
    ) ?? []
  const published = (event: NDKEvent) =>
    setInjected((events) => [event, ...events].slice(0, 50))

  return (
    <GroupProvider value={access}>
      <div className="flex flex-col h-full w-full max-w-[760px] mx-auto md:border-x border-custom">
        <Header
          title={group?.name ?? "Group"}
          rightContent={
            <button
              className="btn btn-ghost btn-circle btn-sm"
              onClick={share}
              aria-label="Copy group link"
            >
              <RiLink size={21} />
            </button>
          }
        >
          <span className="block truncate max-w-[calc(100vw-8rem)] md:max-w-lg">
            {group?.name ?? "Group"}
          </span>
        </Header>
        <ScrollablePageContainer>
          {!group ? (
            <div className="p-10 text-center">
              <p role="status" className="text-base-content/65">
                {access.loading
                  ? "Opening group…"
                  : "This group has not been found on your relays."}
              </p>
              {!access.loading && (
                <button
                  className="btn btn-ghost mt-4"
                  onClick={() => window.location.reload()}
                >
                  Try again
                </button>
              )}
              <Link to="/groups" className="btn btn-ghost mt-4">
                Browse groups
              </Link>
            </div>
          ) : (
            <>
              <section className="px-5 sm:px-7 pt-7 pb-5">
                <div className="flex gap-4 items-start justify-between">
                  <div className="min-w-0">
                    <h1 className="text-3xl font-semibold tracking-tight break-words">
                      {group.name}
                    </h1>
                    <p className="text-sm text-base-content/55 mt-2">
                      Public group ·{" "}
                      <span>{membership?.eligiblePubkeys.size ?? 0} members</span>
                    </p>
                  </div>
                  <button
                    className="btn btn-ghost btn-circle btn-sm"
                    onClick={() => setSettingsOpen(true)}
                    aria-label="Group settings"
                  >
                    <RiSettings3Fill size={20} />
                  </button>
                </div>
                <p className="whitespace-pre-wrap break-words mt-4 text-base-content/80">
                  {group.description}
                </p>
                <div className="flex flex-wrap gap-3 items-center mt-5">
                  <button
                    className={`btn btn-sm ${me?.joined ? "btn-ghost" : "btn-primary"}`}
                    disabled={!!busy || access.loading}
                    onClick={join}
                  >
                    {busy === "membership"
                      ? "Saving…"
                      : me?.joined
                        ? "Leave group"
                        : "Request to join"}
                  </button>
                  {me?.joined && (
                    <span
                      role="status"
                      className={`text-sm ${canParticipate ? "text-success" : "text-base-content/65"}`}
                    >
                      {canParticipate
                        ? "You’re a member"
                        : "Awaiting membership confirmation"}
                    </span>
                  )}
                </div>
                {!me?.joined && (
                  <p className="text-xs text-base-content/50 mt-2">
                    Membership is public.
                  </p>
                )}
                {access.error && (
                  <p role="status" className="text-sm text-warning mt-4">
                    {access.error}
                  </p>
                )}
                {access.error && (
                  <button
                    className="btn btn-ghost btn-sm mt-2"
                    onClick={() => window.location.reload()}
                  >
                    Retry connection
                  </button>
                )}
                {error && (
                  <p role="alert" className="text-error text-sm mt-4">
                    {error}
                  </p>
                )}
              </section>
              <div
                role="tablist"
                aria-label="Group sections"
                className="flex border-b border-custom px-3"
              >
                {(["posts", "polls", "members"] as const).map((item) => (
                  <button
                    key={item}
                    role="tab"
                    aria-selected={tab === item}
                    className={`flex-1 py-3 font-medium capitalize border-b-2 ${tab === item ? "border-primary text-primary" : "border-transparent text-base-content/60"}`}
                    onClick={() => setTab(item)}
                  >
                    {item[0].toUpperCase() + item.slice(1)}
                  </button>
                ))}
              </div>
              {tab !== "members" ? (
                <>
                  {canParticipate &&
                    (tab === "posts" ? (
                      <div>
                        <BaseNoteCreator
                          group={reference}
                          onPublish={published}
                          placeholder={`Post to ${group.name}`}
                          expandOnFocus
                        />
                        <div className="px-4 py-2 flex justify-between items-center">
                          <button
                            className="btn btn-ghost btn-sm gap-2"
                            onClick={() => {
                              setView("creator")
                              setPolling(true)
                            }}
                          >
                            <RiBarChartFill size={18} />
                            Create poll
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="px-5 py-4">
                        <button
                          className="btn btn-primary btn-sm"
                          onClick={() => {
                            setView("creator")
                            setPolling(true)
                          }}
                        >
                          Create poll
                        </button>
                      </div>
                    ))}
                  {view === "personal" && (
                    <button
                      className="btn btn-ghost btn-sm mx-3 my-2"
                      onClick={() => setSettingsOpen(true)}
                    >
                      My network
                    </button>
                  )}
                  <Feed
                    key={`${address}:${tab}:${view}`}
                    feedConfig={feedConfig}
                    eventSource={feed}
                    selectEvents={diversifyGroupFeed}
                    enabled={!access.loading}
                    showDisplayAsSelector={false}
                    emptyPlaceholder={
                      <div className="p-10 text-center text-base-content/55">
                        {feed.error ? (
                          <>
                            <p>{feed.error}</p>
                            <button
                              className="btn btn-ghost btn-sm mt-3"
                              onClick={feed.refresh}
                            >
                              Try again
                            </button>
                          </>
                        ) : tab === "polls" ? (
                          "No polls yet"
                        ) : (
                          "No posts yet"
                        )}
                      </div>
                    }
                  />
                  {feed.canLoadOlder && (
                    <button
                      className="btn btn-ghost w-full"
                      disabled={feed.loading}
                      onClick={feed.loadOlder}
                    >
                      Load older posts
                    </button>
                  )}
                </>
              ) : (
                <section className="px-5 py-5">
                  {members.length > 20 && (
                    <input
                      className="input input-bordered w-full mb-4"
                      aria-label="Filter members by public key"
                      placeholder="Filter by public key"
                      value={memberQuery}
                      onChange={(event) => setMemberQuery(event.target.value)}
                    />
                  )}
                  {members.slice(0, memberLimit).map((member) => (
                    <div
                      key={member.pubkey}
                      className="flex items-start gap-3 py-4"
                      data-testid="group-member"
                      data-pubkey={member.pubkey}
                    >
                      <ProfileLink pubKey={member.pubkey}>
                        <Avatar pubKey={member.pubkey} width={42} />
                      </ProfileLink>
                      <div className="min-w-0 flex-1">
                        <ProfileLink pubKey={member.pubkey}>
                          <Name pubKey={member.pubkey} className="font-semibold" />
                        </ProfileLink>
                        <p className="text-sm text-base-content/55 mt-1">
                          {member.reason.replace(/vouch/g, "confirmation")}
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
                      {canParticipate && member.pubkey !== publicKey && (
                        <button
                          disabled={!!busy}
                          className="btn btn-ghost btn-sm shrink-0"
                          onClick={() =>
                            action(
                              member.pubkey,
                              createMembershipAttestationDraft(
                                reference,
                                member.pubkey,
                                !member.vouchers.includes(publicKey)
                              )
                            )
                          }
                        >
                          {busy === member.pubkey
                            ? "Saving…"
                            : member.vouchers.includes(publicKey)
                              ? "Withdraw confirmation"
                              : "Confirm membership"}
                        </button>
                      )}
                    </div>
                  ))}
                  {members.length > memberLimit && (
                    <button
                      className="btn btn-ghost w-full"
                      onClick={() => setMemberLimit((count) => count + 50)}
                    >
                      Show more members
                    </button>
                  )}
                </section>
              )}
            </>
          )}
        </ScrollablePageContainer>
        {settingsOpen && group && (
          <GroupSettings
            group={group}
            view={view}
            onViewChange={setView}
            onClose={() => setSettingsOpen(false)}
            onEdit={
              publicKey === group.creator
                ? () => {
                    setSettingsOpen(false)
                    setEditing(true)
                  }
                : undefined
            }
          />
        )}
        {editing && group && (
          <GroupForm group={group} onClose={() => setEditing(false)} />
        )}
        {polling && canParticipate && (
          <PollCreator
            group={reference}
            electorate={access.electorate}
            snapshotLoading={access.snapshotLoading}
            snapshotError={access.snapshotError}
            onClose={() => setPolling(false)}
            onPublished={published}
          />
        )}
      </div>
    </GroupProvider>
  )
}
