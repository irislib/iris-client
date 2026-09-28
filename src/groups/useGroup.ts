import {useCallback, useEffect, useMemo, useState} from "react"
import {usePublicKey} from "@/stores/user"
import {useGroupEvents} from "./useGroupEvents"
import {selectGroupFeedAuthors} from "./groupFeed"
import {
  deriveGroupMembers,
  deriveGroupFollowLists,
  deriveGroupElectorate,
  groupAddress,
  listGroups,
  parseGroupEventState,
  protectedGroupFactFilters,
  verifyGroupElectorateEvidence,
  type GroupRef,
} from "./model"

export type GroupView = "creator" | "personal"
export const groupPath = (group: GroupRef) => `/groups/${group.creator}/${group.id}`

export function useGroup(
  ref: GroupRef,
  view: GroupView = "creator",
  reviewMember?: string
) {
  const publicKey = usePublicKey()
  const [, setClock] = useState(0)
  const now = Math.floor(Date.now() / 1000)
  useEffect(() => {
    const timer = setInterval(() => setClock((tick) => tick + 1), 30_000)
    return () => clearInterval(timer)
  }, [])
  const address = groupAddress(ref)
  const metadata = useGroupEvents(
    [{kinds: [37368], authors: [ref.creator], "#d": [ref.id], limit: 5}],
    5
  )
  const group = useMemo(
    () =>
      listGroups(metadata.events, now).find(
        (item) => item.id === ref.id && item.creator === ref.creator
      ),
    [metadata.events, ref.id, ref.creator, now]
  )
  const root = view === "personal" && publicKey ? publicKey : ref.creator
  const rootFollows = useGroupEvents([{kinds: [3], authors: [root], limit: 1}], 1)
  const rootContacts = useMemo(
    () => deriveGroupFollowLists(rootFollows.events, now).get(root) ?? new Set<string>(),
    [rootFollows.events, root, now]
  )
  const direct = useMemo(() => [...rootContacts].sort().slice(0, 256), [rootContacts])
  // Do not subscribe to a public join inbox. Direct trust bounds discovery even
  // when a contact follows or confirms thousands of new identities.
  const discovery = useGroupEvents(
    [
      {
        kinds: [7368],
        authors: [...new Set([ref.creator, root, ...direct])],
        "#a": [address],
        limit: 512,
      },
    ],
    512,
    {perAuthorCap: 16}
  )
  const followLists = useGroupEvents(
    direct.map((author) => ({kinds: [3], authors: [author], limit: 1})),
    256,
    {liveFilters: direct.length ? [{kinds: [3], authors: direct}] : []}
  )
  // Group trust is an explicit signed graph, independent of the viewer's
  // personal cache and its unknown-author ingestion policy.
  const contacts = useMemo(
    () => deriveGroupFollowLists([...rootFollows.events, ...followLists.events], now),
    [rootFollows.events, followLists.events, now]
  )
  const getFollows = useCallback(
    (pubkey: string) => contacts.get(pubkey) ?? [],
    [contacts]
  )
  const criticalMembers = useMemo(
    () =>
      [
        ...new Set([
          ref.creator,
          root,
          ...direct,
          ...(publicKey ? [publicKey] : []),
          // An explicitly opened request gets one reserved evidence slot. This
          // is retrieval only; it never adds the applicant to the trust graph.
          ...(reviewMember && /^[0-9a-f]{64}$/.test(reviewMember) ? [reviewMember] : []),
        ]),
      ].sort(),
    [ref.creator, root, direct, publicKey, reviewMember]
  )
  const criticalFilters = useMemo(
    () => protectedGroupFactFilters(ref, criticalMembers),
    [ref.id, ref.creator, criticalMembers]
  )
  // This key is independent of discovery. Each known author has at most one
  // consent and one vouch per critical target, so those states all fit even if
  // one author floods updates or vouches for every target.
  const protectedFacts = useGroupEvents(
    criticalFilters,
    criticalMembers.length * (criticalMembers.length + 1),
    {
      liveFilters: [{kinds: [7368], authors: criticalMembers, "#a": [address]}],
      perAuthorCap: criticalMembers.length + 1,
      factTargets: criticalMembers,
    }
  )
  const candidateQuery = useMemo(() => {
    const members = new Set(criticalMembers)
    const network = new Set([root, ...direct])
    let scanned = 0
    for (const bridge of direct) {
      for (const author of getFollows(bridge)) {
        if (++scanned > 32768) break
        network.add(author)
      }
      if (scanned > 32768) break
    }
    const vouchers = new Set(criticalMembers)
    const observedMembers = new Set<string>()
    for (const event of discovery.events) {
      const state = parseGroupEventState(event, now)
      if (!state?.memberPubkey) continue
      observedMembers.add(state.memberPubkey)
      if (state.category === "vouch" && network.has(event.pubkey)) {
        vouchers.add(event.pubkey)
        observedMembers.add(event.pubkey)
      }
    }
    for (const member of [...observedMembers].sort()) {
      if (members.size >= 512) break
      members.add(member)
    }
    // A member introduced by a direct contact may supply an independent
    // second-degree confirmation. Fetch their evidence for known targets only;
    // this does not put their contacts or applicants into the request inbox.
    for (const member of members) {
      if (network.has(member)) vouchers.add(member)
    }
    const memberKeys = [...members].sort()
    const voucherKeys = [...vouchers].sort()
    const critical = new Set(criticalMembers)
    const expanded =
      memberKeys.some((key) => !critical.has(key)) ||
      voucherKeys.some((key) => !critical.has(key))
    return {
      memberKeys,
      filters: expanded ? protectedGroupFactFilters(ref, memberKeys, voucherKeys) : [],
      liveFilters: expanded
        ? [
            {
              kinds: [7368],
              authors: [...new Set([...memberKeys, ...voucherKeys])].sort(),
              "#a": [address],
            },
          ]
        : [],
      limited: [...observedMembers].some((key) => !members.has(key)),
    }
  }, [
    ref.id,
    ref.creator,
    root,
    direct,
    criticalMembers,
    discovery.events,
    getFollows,
    now,
    address,
  ])
  const candidateFacts = useGroupEvents(candidateQuery.filters, 2048, {
    liveFilters: candidateQuery.liveFilters,
    perAuthorCap: 32,
    factTargets: candidateQuery.memberKeys,
  })
  const events = useMemo(() => {
    const byId = new Map(
      [...discovery.events, ...candidateFacts.events, ...protectedFacts.events].map(
        (event) => [event.id, event]
      )
    )
    return [...metadata.events, ...byId.values()]
  }, [metadata.events, discovery.events, candidateFacts.events, protectedFacts.events])
  const membership = useMemo(
    () =>
      group
        ? deriveGroupMembers({
            group,
            events,
            viewer: publicKey,
            view,
            getFollows,
            now,
          })
        : undefined,
    [group, events, publicKey, view, getFollows, now]
  )
  const isEligible = useCallback(
    (pubkey: string) => membership?.eligiblePubkeys.has(pubkey) ?? false,
    [membership]
  )
  const visiblePubkeys = useMemo(
    () =>
      new Set(
        selectGroupFeedAuthors(
          membership?.authorityPubkeys ?? [],
          membership?.eligiblePubkeys ?? new Set(),
          publicKey,
          "trusted"
        )
      ),
    [membership, publicKey]
  )
  const isVisibleMember = useCallback(
    (pubkey: string) => visiblePubkeys.has(pubkey),
    [visiblePubkeys]
  )
  const loading =
    metadata.loading ||
    protectedFacts.loading ||
    rootFollows.loading ||
    followLists.loading
  const memberSnapshotLimited =
    discovery.limited ||
    candidateQuery.limited ||
    candidateFacts.limited ||
    candidateFacts.loading ||
    !!candidateFacts.error
  const limited =
    protectedFacts.limited || membership?.truncated || rootContacts.size > 256
  const error =
    metadata.error || protectedFacts.error || rootFollows.error || followLists.error
  const snapshotLoading = loading
  const snapshot = useMemo(() => {
    if (!group || view !== "creator" || snapshotLoading || limited || error)
      return {electorate: null, error: undefined}
    try {
      const electorate = deriveGroupElectorate({
        group,
        events,
        viewer: publicKey,
        getFollows,
        now,
      })
      const rootFollow = rootFollows.events.find(
        (event) => event.pubkey === group.creator
      )
      if (
        electorate.authorityPubkeys.some((pubkey) => pubkey !== group.creator) &&
        !rootFollow
      ) {
        throw new Error("The group’s signed trust list has not arrived yet.")
      }
      electorate.rootFollowEventId = rootFollow?.id
      electorate.memberSnapshotLimited ||=
        memberSnapshotLimited || discovery.loading || !!discovery.error
      const followProofAuthors = new Set(electorate.followProofPubkeys ?? [group.creator])
      const followProofEvents = [...rootFollows.events, ...followLists.events].filter(
        (event) => followProofAuthors.has(event.pubkey)
      )
      electorate.evidenceEventIds = [
        ...new Set([
          ...electorate.evidenceEventIds,
          ...followProofEvents.map((event) => event.id),
        ]),
      ].sort()
      const proofEvents = [...events, ...followProofEvents]
      // Publishing waits until its evidence strictly predates the opening.
      const verified = verifyGroupElectorateEvidence(
        ref,
        electorate,
        proofEvents,
        now + 1
      )
      if (!verified.valid) throw new Error(verified.reason)
      return {electorate, error: undefined}
    } catch (reason) {
      return {
        electorate: null,
        error:
          reason instanceof Error ? reason.message : "Membership could not be checked.",
      }
    }
  }, [
    group,
    view,
    snapshotLoading,
    limited,
    error,
    events,
    getFollows,
    now,
    rootFollows.events,
    followLists.events,
    ref.id,
    ref.creator,
    publicKey,
    memberSnapshotLimited,
    discovery.loading,
    discovery.error,
  ])
  const canParticipate = !!publicKey && !loading && isEligible(publicKey)
  const policyLabel =
    view === "personal" ? "Members · your network" : "Members · group network"
  return useMemo(
    () => ({
      ref,
      group,
      membership,
      isEligible,
      visiblePubkeys,
      isVisibleMember,
      canParticipate,
      loading,
      policyLabel,
      view,
      limited,
      memberSnapshotLimited,
      discoveryLoading: discovery.loading,
      discoveryError: discovery.error,
      error,
      electorate: snapshot.electorate,
      snapshotLoading,
      snapshotError:
        error ||
        (limited
          ? "The membership view is incomplete. A poll cannot be opened from it."
          : snapshot.error),
    }),
    [
      ref.id,
      ref.creator,
      group,
      membership,
      isEligible,
      visiblePubkeys,
      isVisibleMember,
      canParticipate,
      loading,
      policyLabel,
      view,
      limited,
      memberSnapshotLimited,
      discovery.loading,
      discovery.error,
      error,
      snapshot,
      snapshotLoading,
    ]
  )
}

export type GroupAccess = ReturnType<typeof useGroup>
