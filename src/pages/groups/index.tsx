import {useMemo, useState} from "react"
import {RiAddLine, RiGroupFill, RiSearchLine} from "@remixicon/react"
import {Link} from "@/navigation"
import Header from "@/shared/components/header/Header"
import {ScrollablePageContainer} from "@/shared/components/layout/ScrollablePageContainer"
import {Name} from "@/shared/components/user/Name"
import {usePublicKey} from "@/stores/user"
import {useUIStore} from "@/stores/ui"
import {GROUP_DISCOVERY_TAG, groupAddress, listGroups} from "@/groups/model"
import {useGroupEvents} from "@/groups/useGroupEvents"
import {groupPath} from "@/groups/useGroup"
import {useSavedGroups} from "@/groups/savedGroups"
import GroupForm from "@/groups/components/GroupForm"

export default function GroupsPage() {
  const publicKey = usePublicKey()
  const [query, setQuery] = useState("")
  const [creating, setCreating] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)
  const accounts = useSavedGroups((state) => state.accounts)
  const saved = accounts[publicKey] ?? []
  const discovery = useGroupEvents(
    [{kinds: [37368], "#t": [GROUP_DISCOVERY_TAG], limit: 100}],
    100,
    {refreshKey}
  )
  const known = useGroupEvents(
    saved.map((ref) => ({
      kinds: [37368],
      authors: [ref.creator],
      "#d": [ref.id],
      limit: 1,
    })),
    100,
    {refreshKey}
  )
  const groups = useMemo(
    () =>
      listGroups([...discovery.events, ...known.events])
        .filter((group) =>
          `${group.name} ${group.description}`
            .toLocaleLowerCase()
            .includes(query.toLocaleLowerCase().trim())
        )
        .sort((a, b) => {
          const isSaved = (group: typeof a) =>
            saved.some((ref) => groupAddress(ref) === groupAddress(group)) ||
            group.creator === publicKey
          return Number(isSaved(b)) - Number(isSaved(a)) || b.createdAt - a.createdAt
        }),
    [discovery.events, known.events, publicKey, accounts, query]
  )
  const create = () =>
    publicKey ? setCreating(true) : useUIStore.getState().setShowLoginDialog(true)
  const loadError = discovery.error || known.error
  const retry = (
    <button
      className="btn btn-ghost btn-sm"
      onClick={() => setRefreshKey((value) => value + 1)}
    >
      Try again
    </button>
  )
  return (
    <div className="flex flex-col h-full">
      <Header
        title="Groups"
        showBack={CONFIG.appVariant !== "groups"}
        rightContent={
          <button
            onClick={create}
            className="btn btn-primary btn-sm gap-1"
            aria-label="Create group"
          >
            <RiAddLine size={18} />
            <span className="hidden sm:inline">Create group</span>
          </button>
        }
      />
      <ScrollablePageContainer>
        <div className="mx-auto max-w-3xl px-5 sm:px-8 py-8">
          <div className="flex items-center gap-3 mb-3">
            <RiGroupFill className="text-primary" size={34} />
            <h1 className="text-3xl font-semibold tracking-tight">
              A place for your people.
            </h1>
          </div>
          <p className="text-base-content/60 mb-7">
            Public conversations. Shared decisions. Membership through people you trust.
          </p>
          <label className="input input-bordered flex items-center gap-3 mb-6">
            <RiSearchLine size={20} className="opacity-50" />
            <input
              aria-label="Find a group"
              className="grow min-w-0"
              placeholder="Find a group"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          {groups.length ? (
            <div className="flex flex-col gap-1">
              {groups.map((group) => (
                <Link
                  key={groupAddress(group)}
                  to={groupPath(group)}
                  className="flex gap-4 py-5 px-3 -mx-3 rounded-xl hover:bg-base-content/5 transition-colors"
                >
                  <span
                    className="flex shrink-0 items-center justify-center w-14 h-14 rounded-2xl bg-primary/10 text-primary font-semibold text-xl"
                    aria-hidden="true"
                  >
                    {group.name.slice(0, 1).toLocaleUpperCase()}
                  </span>
                  <div className="min-w-0 flex-1">
                    <h2 className="text-lg font-semibold break-words">{group.name}</h2>
                    <p className="text-base-content/65 line-clamp-2 mt-1 break-words">
                      {group.description}
                    </p>
                    <p className="text-sm text-base-content/45 mt-2">
                      Started by <Name pubKey={group.creator} />
                    </p>
                  </div>
                </Link>
              ))}
            </div>
          ) : discovery.loading ? (
            <p role="status" className="py-14 text-center text-base-content/60">
              Finding groups…
            </p>
          ) : loadError ? (
            <div role="status" className="py-12 text-center text-base-content/60">
              <p className="mb-3">Couldn’t load groups.</p>
              {retry}
            </div>
          ) : (
            <div className="py-12 text-center">
              <h2 className="text-xl font-semibold">
                {query ? "No matching groups" : "Start something together"}
              </h2>
              <p className="mt-2 text-base-content/60">
                {query
                  ? "Try another name, or open a group’s invitation link."
                  : "Create a group, then share its link with your people."}
              </p>
              {!query && (
                <button onClick={create} className="btn btn-primary mt-6">
                  Create group
                </button>
              )}
            </div>
          )}
          {loadError && groups.length > 0 && (
            <div
              role="status"
              className="mt-4 flex flex-wrap items-center gap-2 text-sm text-base-content/60"
            >
              <span>Some groups may be missing.</span>
              {retry}
            </div>
          )}
        </div>
      </ScrollablePageContainer>
      {creating && <GroupForm onClose={() => setCreating(false)} />}
    </div>
  )
}
