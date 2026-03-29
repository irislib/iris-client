import {
  BlossomStore,
  FallbackStore,
  HashTree,
  LinkType,
  MemoryStore,
  nhashDecode,
  nhashEncode,
  type BlossomServer,
  type CID,
  type TreeEntry,
} from "@hashtree/core"
import {SearchIndex} from "@hashtree/index"
import Fuse from "fuse.js"

import {db} from "../lib/ndk-cache"
import {
  buildProfileSearchResult,
  type SearchResult,
} from "../utils/profileSearchData"

const FUSE_KEYS = ["name", "aliases", "nip05", "pubKey"]
const PROFILE_SEARCH_PREFIX = "p:"
const REMOTE_SEARCH_SHORT_QUERY_LIMIT = 8
const REMOTE_SEARCH_MEDIUM_QUERY_LIMIT = 16
const REMOTE_SEARCH_FETCH_LIMIT = 64
const REMOTE_SEARCH_INITIAL_HYDRATE_LIMIT = 16
const REMOTE_SEARCH_BACKGROUND_HYDRATE_LIMIT = 12
const PROFILE_SEARCH_ROOT_CACHE_PREFIX = "profile-search-root"

const DEFAULT_BLOSSOM_SERVERS: BlossomServer[] = [
  {url: "https://upload.iris.to", read: false, write: true},
  {url: "https://cdn.iris.to", read: true, write: false},
  {url: "https://hashtree.iris.to", read: true, write: false},
]

export type SearchHitSource = "local" | "remote"
export type SearchHit = {
  item: SearchResult
  score?: number
  source?: SearchHitSource
}
export type SearchProgressCallback = (results: SearchHit[]) => void

type RemoteSearchContext = {
  index: SearchIndex
  tree: HashTree
  target: RemoteSearchTarget
}

type RemoteSearchTarget =
  | {kind: "root"; root: CID}
  | {kind: "tree"; npub: string; treeName: string}

type RemoteTreeSnapshotRecord = {
  nhash: string
  eventId?: string
  createdAt?: number
}

type RemoteResolvedTreeRoot = {
  root: CID
  eventId?: string
  createdAt?: number
}

type StoredRemoteProfileSearchEntry = {
  pubkey?: string
  name?: string
  aliases?: string[]
  nip05?: string
  picture?: string
  created_at?: number
  event_nhash?: string
}

type RemoteProfileSearchTreeResolver = (
  npub: string,
  treeName: string,
  current: RemoteTreeSnapshotRecord | null
) => Promise<RemoteResolvedTreeRoot | null>

let searchIndex: Fuse<SearchResult> = new Fuse<SearchResult>([], {
  keys: FUSE_KEYS,
  includeScore: true,
})

const latestProfileTimestamps = new Map<string, number>()
const cachedProfiles = new Map<string, SearchResult>()
const inflightTreeRootRefreshes = new Map<
  string,
  Promise<RemoteResolvedTreeRoot | null>
>()
let remoteSearch: RemoteSearchContext | null | undefined
let remoteProfileSearchTreeResolver: RemoteProfileSearchTreeResolver | null = null

const REMOTE_SEARCH_SHORT_QUERY_DEBOUNCE_MS = 150
const REMOTE_SEARCH_MEDIUM_QUERY_DEBOUNCE_MS = 120
const REMOTE_SEARCH_DEFAULT_DEBOUNCE_MS = 100
const REMOTE_SEARCH_CACHE_TIMEOUT_MS = 4000

export function setRemoteProfileSearchTreeResolver(
  resolver: RemoteProfileSearchTreeResolver | null
) {
  remoteProfileSearchTreeResolver = resolver
}

function parseBlossomServers(raw?: string): BlossomServer[] {
  if (!raw) {
    return DEFAULT_BLOSSOM_SERVERS
  }

  const urls = raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)

  if (urls.length === 0) {
    return DEFAULT_BLOSSOM_SERVERS
  }

  return urls.map((url) => ({
    url,
    ...inferBlossomRole(url),
  }))
}

function inferBlossomRole(url: string): Pick<BlossomServer, "read" | "write"> {
  try {
    const host = new URL(url).hostname
    if (host.startsWith("upload.")) {
      return {read: false, write: true}
    }
    if (host.startsWith("cdn.") || host.startsWith("hashtree.")) {
      return {read: true, write: false}
    }
  } catch {
    // Fall through to the read-only default.
  }

  return {read: true, write: false}
}

function resolveIndexRef(): string | null {
  const raw =
    import.meta.env.VITE_PROFILE_SEARCH_INDEX ??
    import.meta.env.VITE_PROFILE_SEARCH_NHASH

  if (!raw || typeof raw !== "string") {
    return null
  }

  const trimmed = raw.trim()
  return trimmed.length > 0 ? trimmed : null
}

function resolveIndexSnapshotRef(): string | null {
  const raw =
    import.meta.env.VITE_PROFILE_SEARCH_INDEX_SNAPSHOT ??
    import.meta.env.VITE_PROFILE_SEARCH_SNAPSHOT_NHASH

  if (!raw || typeof raw !== "string") {
    return null
  }

  const trimmed = raw.trim()
  return trimmed.length > 0 ? trimmed : null
}

function parseTreeRef(indexRef: string): {npub: string; treeName: string} | null {
  const slashIndex = indexRef.indexOf("/")
  if (slashIndex <= 0 || slashIndex === indexRef.length - 1) {
    return null
  }

  const npub = indexRef.slice(0, slashIndex)
  const treeName = indexRef.slice(slashIndex + 1)
  if (!npub.startsWith("npub1") || treeName.length === 0) {
    return null
  }

  return {npub, treeName}
}

function createRemoteSearch(): RemoteSearchContext | null {
  const indexRef = resolveIndexRef()
  if (!indexRef) {
    return null
  }

  try {
    const remoteStore = new BlossomStore({
      servers: parseBlossomServers(import.meta.env.VITE_BLOSSOM_SERVERS),
    })
    const store = new FallbackStore({
      primary: new MemoryStore(),
      fallbacks: [remoteStore],
      timeout: REMOTE_SEARCH_CACHE_TIMEOUT_MS,
    })
    const treeRef = parseTreeRef(indexRef)
    const target = treeRef
      ? ({kind: "tree", ...treeRef} satisfies RemoteSearchTarget)
      : indexRef.startsWith("nhash1")
        ? ({kind: "root", root: nhashDecode(indexRef)} satisfies RemoteSearchTarget)
        : null
    if (!target) {
      return null
    }
    return {
      index: new SearchIndex(store),
      tree: new HashTree({store}),
      target,
    }
  } catch (error) {
    console.warn("Invalid profile search index ref:", error)
    return null
  }
}

function getRemoteSearch(): RemoteSearchContext | null {
  if (remoteSearch === undefined) {
    remoteSearch = createRemoteSearch()
  }
  return remoteSearch
}

function rememberProfile(profile: SearchResult) {
  cachedProfiles.set(profile.pubKey, profile)
  if (profile.created_at) {
    latestProfileTimestamps.set(profile.pubKey, profile.created_at)
  }
}

export function updateSearchIndex(profile: SearchResult) {
  if (!profile.name) return

  const lastSeen = latestProfileTimestamps.get(profile.pubKey) || 0
  if (profile.created_at && profile.created_at <= lastSeen) return

  rememberProfile(profile)
  searchIndex.remove((existingProfile) => existingProfile.pubKey === profile.pubKey)
  searchIndex.add({...profile, name: String(profile.name)})
}

export function initSearchIndex(profiles: SearchResult[]) {
  const validProfiles = profiles.filter((p) => p.name)
  searchIndex = new Fuse<SearchResult>(validProfiles, {
    keys: FUSE_KEYS,
    includeScore: true,
  })

  latestProfileTimestamps.clear()
  cachedProfiles.clear()
  for (const profile of validProfiles) {
    rememberProfile(profile)
  }
}

export function searchLocalProfiles(query: string): SearchHit[] {
  return searchIndex
    .search(query)
    .map((result) => ({
      item: result.item,
      score: result.score,
      source: "local" as const,
    }))
}

function queryShape(query: string): {compactLength: number; keywordCount: number} {
  return {
    compactLength: query.replace(/\s+/g, "").length,
    keywordCount: query
      .trim()
      .split(/\s+/)
      .filter(Boolean).length,
  }
}

export function shouldSkipRemoteProfileSearch(query: string): boolean {
  const {compactLength, keywordCount} = queryShape(query)
  return keywordCount <= 1 && compactLength <= 1
}

export function getRemoteProfileSearchDebounceMs(query: string): number {
  if (shouldSkipRemoteProfileSearch(query)) {
    return 0
  }

  const {compactLength, keywordCount} = queryShape(query)
  if (keywordCount <= 1 && compactLength <= 2) {
    return REMOTE_SEARCH_SHORT_QUERY_DEBOUNCE_MS
  }
  if (keywordCount <= 1 && compactLength <= 3) {
    return REMOTE_SEARCH_MEDIUM_QUERY_DEBOUNCE_MS
  }
  return REMOTE_SEARCH_DEFAULT_DEBOUNCE_MS
}

function profileSearchRootCacheKey(npub: string, treeName: string): string {
  return `${PROFILE_SEARCH_ROOT_CACHE_PREFIX}:${npub}/${treeName}`
}

function compareRootSnapshots(
  left: Pick<RemoteTreeSnapshotRecord, "createdAt" | "eventId"> | null,
  right: Pick<RemoteTreeSnapshotRecord, "createdAt" | "eventId"> | null
): number {
  const leftCreatedAt = left?.createdAt ?? 0
  const rightCreatedAt = right?.createdAt ?? 0
  if (leftCreatedAt !== rightCreatedAt) {
    return leftCreatedAt - rightCreatedAt
  }
  return (left?.eventId ?? "").localeCompare(right?.eventId ?? "")
}

function rootsEqual(left: CID, right: CID): boolean {
  return nhashEncode(left) === nhashEncode(right)
}

function resolveSeededTreeRoot():
  | (RemoteResolvedTreeRoot & RemoteTreeSnapshotRecord)
  | null {
  const snapshot = resolveIndexSnapshotRef()
  if (!snapshot?.startsWith("nhash1")) {
    return null
  }

  try {
    return {
      nhash: snapshot,
      root: nhashDecode(snapshot),
    }
  } catch (error) {
    console.warn("[Relay Worker] Invalid profile search snapshot root:", error)
    return null
  }
}

function selectStartupTreeRoot(
  cached:
    | (RemoteResolvedTreeRoot & RemoteTreeSnapshotRecord)
    | null,
  seeded:
    | (RemoteResolvedTreeRoot & RemoteTreeSnapshotRecord)
    | null
):
  | (RemoteResolvedTreeRoot & RemoteTreeSnapshotRecord)
  | null {
  if (seeded) {
    return seeded
  }
  return cached
}

async function readCachedTreeRoot(
  npub: string,
  treeName: string
): Promise<(RemoteResolvedTreeRoot & RemoteTreeSnapshotRecord) | null> {
  try {
    const cached = await db.cacheData.get(profileSearchRootCacheKey(npub, treeName))
    const data = cached?.data as RemoteTreeSnapshotRecord | undefined
    if (!data?.nhash) {
      return null
    }

    return {
      ...data,
      root: nhashDecode(data.nhash),
    }
  } catch (error) {
    console.warn("[Relay Worker] Failed to read cached profile search root:", error)
    return null
  }
}

async function writeCachedTreeRoot(
  npub: string,
  treeName: string,
  snapshot: RemoteResolvedTreeRoot
): Promise<void> {
  try {
    await db.cacheData.put({
      key: profileSearchRootCacheKey(npub, treeName),
      data: {
        nhash: nhashEncode(snapshot.root),
        eventId: snapshot.eventId,
        createdAt: snapshot.createdAt,
      } satisfies RemoteTreeSnapshotRecord,
      cachedAt: Date.now(),
    })
  } catch (error) {
    console.warn("[Relay Worker] Failed to cache profile search root:", error)
  }
}

function decodeRemoteProfileEvent(
  bytes: Uint8Array,
  fallbackPubKey: string
):
  | {
      rawProfile: Record<string, unknown>
      searchProfile: SearchResult
    }
  | undefined {
  const eventJson = new TextDecoder().decode(bytes)
  const event = JSON.parse(eventJson) as {
    pubkey?: string
    content?: string
    created_at?: number
  }
  const resolvedPubKey = event.pubkey || fallbackPubKey
  const profile =
    typeof event.content === "string" ? JSON.parse(event.content) : undefined
  if (!profile || typeof profile !== "object") {
    return undefined
  }

  const rawProfile = profile as Record<string, unknown>
  const searchProfile = buildProfileSearchResult(
    resolvedPubKey,
    rawProfile,
    event.created_at
  )

  if (!searchProfile) {
    return undefined
  }

  return {
    rawProfile,
    searchProfile,
  }
}

async function cacheRemoteProfile(
  searchProfile: SearchResult,
  rawProfile?: Record<string, unknown>
): Promise<void> {
  if (!db?.profiles) {
    return
  }

  try {
    await db.profiles.put({
      ...(rawProfile ?? {}),
      pubkey: searchProfile.pubKey,
      cachedAt: Date.now(),
      created_at: searchProfile.created_at,
      name:
        typeof rawProfile?.name === "string" && rawProfile.name.trim().length > 0
          ? rawProfile.name
          : searchProfile.name,
      display_name:
        typeof rawProfile?.display_name === "string" && rawProfile.display_name.trim().length > 0
          ? rawProfile.display_name
          : typeof rawProfile?.displayName === "string" &&
              rawProfile.displayName.trim().length > 0
            ? rawProfile.displayName
            : searchProfile.name,
      nip05:
        typeof rawProfile?.nip05 === "string" ? rawProfile.nip05 : searchProfile.nip05,
      picture:
        typeof rawProfile?.picture === "string"
          ? rawProfile.picture
          : searchProfile.picture,
    })
  } catch (error) {
    console.warn("[Relay Worker] Failed to cache remote profile search result:", error)
  }
}

type ImmediateRemoteSearchHit = SearchHit & {eventNhash?: string}

function parseStoredRemoteSearchHit(
  result: {id: string; value: string; score: number}
): ImmediateRemoteSearchHit | null {
  try {
    const parsed = JSON.parse(result.value) as StoredRemoteProfileSearchEntry
    const pubKey = parsed.pubkey || result.id
    const name = typeof parsed.name === "string" && parsed.name.trim() ? parsed.name : pubKey
    const aliases = Array.isArray(parsed.aliases)
      ? parsed.aliases.filter((alias): alias is string => typeof alias === "string" && alias.length > 0)
      : undefined
    const searchResult: SearchResult = {
      pubKey,
      name,
      aliases: aliases && aliases.length > 0 ? aliases : undefined,
      nip05: typeof parsed.nip05 === "string" && parsed.nip05.length > 0 ? parsed.nip05 : undefined,
      picture:
        typeof parsed.picture === "string" && parsed.picture.length > 0
          ? parsed.picture
          : undefined,
      created_at:
        typeof parsed.created_at === "number" ? parsed.created_at : undefined,
    }
    updateSearchIndex(searchResult)
    return {
      item: searchResult,
      score: result.score,
      source: "remote",
      eventNhash:
        typeof parsed.event_nhash === "string" && parsed.event_nhash.startsWith("nhash1")
          ? parsed.event_nhash
          : undefined,
    }
  } catch (error) {
    console.warn("[Relay Worker] Failed to decode stored remote profile search result:", error)
    return null
  }
}

async function resolveRemoteProfile(
  pubKey: string,
  cid: CID,
  remote: RemoteSearchContext
): Promise<SearchResult> {
  const cached = cachedProfiles.get(pubKey)
  if (cached) {
    return cached
  }

  try {
    const bytes = await remote.tree.readFile(cid)
    if (!bytes) {
      return {pubKey, name: pubKey}
    }

    const decoded = decodeRemoteProfileEvent(bytes, pubKey)

    if (decoded) {
      updateSearchIndex(decoded.searchProfile)
      void cacheRemoteProfile(decoded.searchProfile, decoded.rawProfile)
      return decoded.searchProfile
    }
  } catch (error) {
    console.warn("[Relay Worker] Failed to resolve remote profile search result:", error)
  }

  return {pubKey, name: pubKey}
}

async function hydrateImmediateRemoteSearchHit(
  hit: ImmediateRemoteSearchHit,
  remote: RemoteSearchContext
): Promise<SearchHit | null> {
  if (!hit.eventNhash) {
    return null
  }

  try {
    const bytes = await remote.tree.readFile(nhashDecode(hit.eventNhash))
    if (!bytes) {
      return null
    }
    const decoded = decodeRemoteProfileEvent(bytes, hit.item.pubKey)
    if (decoded) {
      updateSearchIndex(decoded.searchProfile)
      void cacheRemoteProfile(decoded.searchProfile, decoded.rawProfile)
      const mergedItem: SearchResult = {
        ...hit.item,
        ...decoded.searchProfile,
        aliases: decoded.searchProfile.aliases ?? hit.item.aliases,
        nip05: decoded.searchProfile.nip05 ?? hit.item.nip05,
        picture: decoded.searchProfile.picture ?? hit.item.picture,
        created_at:
          Math.max(hit.item.created_at ?? 0, decoded.searchProfile.created_at ?? 0) ||
          undefined,
      }
      return {
        item: mergedItem,
        score: hit.score,
        source: "remote",
      }
    }
  } catch (error) {
    console.warn("[Relay Worker] Failed to hydrate immediate remote profile hit:", error)
  }

  return null
}

function sameSearchHit(left: SearchHit, right: SearchHit): boolean {
  const leftAliases = left.item.aliases ?? []
  const rightAliases = right.item.aliases ?? []

  return (
    left.item.pubKey === right.item.pubKey &&
    left.item.name === right.item.name &&
    left.item.nip05 === right.item.nip05 &&
    left.item.picture === right.item.picture &&
    left.item.created_at === right.item.created_at &&
    left.score === right.score &&
    leftAliases.length === rightAliases.length &&
    leftAliases.every((alias, index) => alias === rightAliases[index])
  )
}

function hydrateImmediateRemoteSearchHitsInBackground(
  hits: ImmediateRemoteSearchHit[],
  remote: RemoteSearchContext,
  onProgress?: SearchProgressCallback
): void {
  const immediateHits = hits.map(({eventNhash: _eventNhash, ...hit}) => hit)
  const batch = hits.slice(0, REMOTE_SEARCH_BACKGROUND_HYDRATE_LIMIT)
  if (immediateHits.length === 0 || batch.length === 0) {
    return
  }

  queueMicrotask(() => {
    void (async () => {
      for (let index = 0; index < batch.length; index += 1) {
        const hydratedHit = await hydrateImmediateRemoteSearchHit(batch[index], remote)
        if (!hydratedHit || sameSearchHit(immediateHits[index], hydratedHit)) {
          continue
        }

        immediateHits[index] = hydratedHit
        onProgress?.([...immediateHits])
      }
    })()
  })
}

async function searchRemoteRoot(
  remote: RemoteSearchContext,
  root: CID,
  query: string,
  onProgress?: SearchProgressCallback
): Promise<SearchHit[]> {
  const keyOnlyResults = await searchRemoteRootByKeys(remote, root, query)
  if (keyOnlyResults.length > 0) {
    onProgress?.(keyOnlyResults)
    return keyOnlyResults
  }

  const fetchLimit = remoteSearchFetchLimit(query)
  const immediateResults = (
    await remote.index.search(root, PROFILE_SEARCH_PREFIX, query, {
      limit: fetchLimit,
    })
  )
    .map(parseStoredRemoteSearchHit)
    .filter((result): result is ImmediateRemoteSearchHit => Boolean(result))

  if (immediateResults.length > 0) {
    const hits = immediateResults.map(({eventNhash: _eventNhash, ...hit}) => hit)
    onProgress?.(hits)
    hydrateImmediateRemoteSearchHitsInBackground(immediateResults, remote, onProgress)
    return hits
  }

  const results = await remote.index.searchLinks(root, PROFILE_SEARCH_PREFIX, query, {
    limit: fetchLimit,
  })

  if (results.length === 0) {
    return []
  }

  const initialBatch = results.slice(0, REMOTE_SEARCH_INITIAL_HYDRATE_LIMIT)
  const progressiveHydrated = new Array<SearchHit | undefined>(initialBatch.length)
  const hydratedInitial = await Promise.all(
    initialBatch.map(async (result, index) => {
      const hit = {
        item: await resolveRemoteProfile(result.id, result.cid, remote),
        score: result.score,
        source: "remote" as const,
      }
      progressiveHydrated[index] = hit
      onProgress?.(
        progressiveHydrated.filter((candidate): candidate is SearchHit => Boolean(candidate))
      )
      return hit
    })
  )

  if (results.length <= initialBatch.length) {
    return hydratedInitial
  }

  const hydratedRest = await Promise.all(
    results.slice(initialBatch.length).map(async (result) => ({
      item: await resolveRemoteProfile(result.id, result.cid, remote),
      score: result.score,
      source: "remote" as const,
    }))
  )

  return [...hydratedInitial, ...hydratedRest]
}

type KeyOnlySearchAccumulator = {
  score: number
  exactMatches: number
  prefixDistance: number
  matchedTerms: Set<string>
}

async function searchRemoteRootByKeys(
  remote: RemoteSearchContext,
  root: CID,
  query: string
): Promise<SearchHit[]> {
  const fetchLimit = remoteSearchFetchLimit(query)
  const keywords = remote.index.parseKeywords(query)
  if (keywords.length === 0) {
    return []
  }

  const results = new Map<string, KeyOnlySearchAccumulator>()

  for (const keyword of keywords) {
    const searchPrefix = `${PROFILE_SEARCH_PREFIX}${keyword}`
    let count = 0

    for await (const key of prefixTreeKeys(remote.tree, root, searchPrefix)) {
      if (count++ >= fetchLimit * 2) {
        break
      }

      const afterPrefix = key.slice(PROFILE_SEARCH_PREFIX.length)
      const colonIndex = afterPrefix.indexOf(":")
      if (colonIndex === -1) {
        continue
      }

      const term = afterPrefix.slice(0, colonIndex)
      const pubKey = afterPrefix.slice(colonIndex + 1)
      const exactMatch = term === keyword ? 1 : 0
      const prefixDistance = Math.max(0, term.length - keyword.length)

      const existing = results.get(pubKey)
      if (existing) {
        existing.score += 1
        existing.exactMatches += exactMatch
        existing.prefixDistance += prefixDistance
        existing.matchedTerms.add(term)
        continue
      }

      results.set(pubKey, {
        score: 1,
        exactMatches: exactMatch,
        prefixDistance,
        matchedTerms: new Set([term]),
      })
    }
  }

  return [...results.entries()]
    .sort((a, b) => {
      if (b[1].score !== a[1].score) return b[1].score - a[1].score
      if (b[1].exactMatches !== a[1].exactMatches) {
        return b[1].exactMatches - a[1].exactMatches
      }
      if (a[1].prefixDistance !== b[1].prefixDistance) {
        return a[1].prefixDistance - b[1].prefixDistance
      }
      return a[0].localeCompare(b[0])
    })
    .slice(0, fetchLimit)
    .map(([pubKey, result]) => ({
      item: {
        pubKey,
        name: "",
        aliases: [...result.matchedTerms],
      },
      score: result.score,
      source: "remote" as const,
    }))
}

async function *prefixTreeKeys(
  tree: HashTree,
  node: CID,
  prefix: string
): AsyncGenerator<string> {
  yield *rangeTreeKeys(tree, node, prefix, incrementPrefix(prefix))
}

async function *rangeTreeKeys(
  tree: HashTree,
  node: CID,
  start?: string,
  end?: string
): AsyncGenerator<string> {
  const entries = sortTreeEntries(await tree.listDirectory(node))

  if (isLeafNode(entries)) {
    for (const entry of entries) {
      if (entry.type === LinkType.Dir) {
        continue
      }

      const key = unescapeSearchKey(entry.name)
      if (start !== undefined && key < start) {
        continue
      }
      if (end !== undefined && key >= end) {
        return
      }

      yield key
    }
    return
  }

  for (let index = 0; index < entries.length; index += 1) {
    const child = entries[index]
    const childMinKey = unescapeSearchKey(child.name)
    const childMaxKey =
      index < entries.length - 1 ? unescapeSearchKey(entries[index + 1].name) : undefined

    if (
      start !== undefined &&
      childMaxKey !== undefined &&
      childMaxKey <= start
    ) {
      continue
    }
    if (end !== undefined && childMinKey >= end) {
      return
    }

    yield *rangeTreeKeys(tree, child.cid, start, end)
  }
}

function sortTreeEntries(entries: TreeEntry[]): TreeEntry[] {
  return [...entries].sort((left, right) =>
    unescapeSearchKey(left.name).localeCompare(unescapeSearchKey(right.name))
  )
}

function isLeafNode(entries: TreeEntry[]): boolean {
  return entries.length === 0 || entries.some((entry) => entry.type !== LinkType.Dir)
}

function unescapeSearchKey(name: string): string {
  return name
    .replace(/%2F/gi, "/")
    .replace(/%00/gi, "\0")
    .replace(/%25/g, "%")
}

function incrementPrefix(value: string): string {
  if (value.length === 0) {
    return value
  }
  const lastChar = value.charCodeAt(value.length - 1)
  return value.slice(0, -1) + String.fromCharCode(lastChar + 1)
}

function mergeSearchHits(...groups: SearchHit[][]): SearchHit[] {
  const merged = new Map<string, SearchHit>()
  for (const group of groups) {
    for (const hit of group) {
      const existing = merged.get(hit.item.pubKey)
      if (!existing) {
        merged.set(hit.item.pubKey, hit)
        continue
      }

      const existingCreatedAt = existing.item.created_at ?? 0
      const nextCreatedAt = hit.item.created_at ?? 0
      const existingCompleteness =
        (existing.item.name !== existing.item.pubKey ? 1 : 0) +
        (existing.item.nip05 ? 1 : 0) +
        (existing.item.picture ? 1 : 0) +
        ((existing.item.aliases?.length ?? 0) > 0 ? 1 : 0)
      const nextCompleteness =
        (hit.item.name !== hit.item.pubKey ? 1 : 0) +
        (hit.item.nip05 ? 1 : 0) +
        (hit.item.picture ? 1 : 0) +
        ((hit.item.aliases?.length ?? 0) > 0 ? 1 : 0)

      if (
        nextCreatedAt > existingCreatedAt ||
        (nextCreatedAt === existingCreatedAt && nextCompleteness > existingCompleteness)
      ) {
        merged.set(hit.item.pubKey, {
          item: hit.item,
          score: existing.score ?? hit.score,
        })
      }
    }
  }
  return Array.from(merged.values())
}

export function mergeSearchProfiles(...groups: SearchHit[][]): SearchHit[] {
  return mergeSearchHits(...groups)
}

function remoteSearchFetchLimit(query: string): number {
  const {compactLength, keywordCount} = queryShape(query)

  if (keywordCount <= 1 && compactLength <= 2) {
    return REMOTE_SEARCH_SHORT_QUERY_LIMIT
  }
  if (keywordCount <= 1 && compactLength <= 3) {
    return REMOTE_SEARCH_MEDIUM_QUERY_LIMIT
  }
  return REMOTE_SEARCH_FETCH_LIMIT
}

async function resolveLiveTreeRoot(
  npub: string,
  treeName: string,
  current: RemoteTreeSnapshotRecord | null
): Promise<RemoteResolvedTreeRoot | null> {
  if (!remoteProfileSearchTreeResolver) {
    return null
  }

  try {
    return await remoteProfileSearchTreeResolver(npub, treeName, current)
  } catch (error) {
    console.warn("[Relay Worker] Failed to refresh profile search tree root:", error)
    return null
  }
}

async function getOrStartTreeRootRefresh(
  npub: string,
  treeName: string,
  current: (RemoteResolvedTreeRoot & RemoteTreeSnapshotRecord) | null
): Promise<RemoteResolvedTreeRoot | null> {
  const cacheKey = profileSearchRootCacheKey(npub, treeName)
  const existing = inflightTreeRootRefreshes.get(cacheKey)
  if (existing) {
    return existing
  }

  const refresh = (async () => {
    const live = await resolveLiveTreeRoot(npub, treeName, current)
    if (!live) {
      return null
    }

    const liveIsNew =
      !current ||
      compareRootSnapshots(live, current) > 0 ||
      (current.root ? !rootsEqual(live.root, current.root) : true)
    if (liveIsNew) {
      await writeCachedTreeRoot(npub, treeName, live)
    }

    return live
  })()

  inflightTreeRootRefreshes.set(cacheKey, refresh)
  refresh.finally(() => {
    inflightTreeRootRefreshes.delete(cacheKey)
  })
  return refresh
}

export async function searchRemoteProfiles(
  query: string,
  onProgress?: SearchProgressCallback
): Promise<SearchHit[]> {
  if (shouldSkipRemoteProfileSearch(query)) {
    return []
  }

  const remote = getRemoteSearch()
  if (!remote) {
    return []
  }

  if (remote.target.kind === "root") {
    return searchRemoteRoot(remote, remote.target.root, query, onProgress)
  }

  const {npub, treeName} = remote.target
  const cached = await readCachedTreeRoot(npub, treeName)
  const seeded = resolveSeededTreeRoot()
  const current = selectStartupTreeRoot(cached, seeded)
  if (current) {
    const cachedResults = await searchRemoteRoot(
      remote,
      current.root,
      query,
      onProgress
    )
    const refresh = getOrStartTreeRootRefresh(npub, treeName, current)
    if (cachedResults.length > 0) {
      void refresh
      return cachedResults
    }

    const live = await refresh
    if (!live || rootsEqual(current.root, live.root)) {
      return cachedResults
    }

    const liveResults = await searchRemoteRoot(remote, live.root, query, onProgress)
    return mergeSearchHits(cachedResults, liveResults)
  }

  const live = await getOrStartTreeRootRefresh(npub, treeName, null)
  if (!live) {
    return []
  }

  return searchRemoteRoot(remote, live.root, query, onProgress)
}

export async function searchProfilesWithProgress(
  query: string,
  onProgress?: SearchProgressCallback
): Promise<SearchHit[]> {
  const trimmed = query.trim()
  if (!trimmed) {
    return []
  }

  const localResults = searchLocalProfiles(trimmed)
  onProgress?.(localResults)
  const remoteResults = await searchRemoteProfiles(trimmed, (partialRemoteResults) => {
    onProgress?.(mergeSearchHits(localResults, partialRemoteResults))
  })

  if (remoteResults.length === 0) {
    return localResults
  }

  return mergeSearchHits(localResults, remoteResults)
}

export async function searchProfiles(query: string): Promise<SearchHit[]> {
  return searchProfilesWithProgress(query)
}
