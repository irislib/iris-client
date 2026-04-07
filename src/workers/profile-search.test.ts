import {beforeEach, describe, expect, it, vi} from "vitest"
import {nip19} from "nostr-tools"

import {
  buildProfileSearchResult,
  hasProfileSearchExactMatch,
  hasProfileSearchTextMatch,
} from "../utils/profileSearchData"

const searchMock = vi.fn()
const searchLinksMock = vi.fn()
const readFileMock = vi.fn()
const listDirectoryMock = vi.fn()
const cacheGetMock = vi.fn()
const cachePutMock = vi.fn()
const profilesPutMock = vi.fn()
const nhashDecodeMock = vi.fn()
const nhashEncodeMock = vi.fn()

vi.mock("@hashtree/index", () => ({
  SearchIndex: vi.fn().mockImplementation(() => ({
    parseKeywords: (query: string) => [query.toLowerCase()],
    search: searchMock,
    searchLinks: searchLinksMock,
  })),
}))

vi.mock("@hashtree/core", () => ({
  BlossomStore: vi.fn().mockImplementation(() => ({})),
  MemoryStore: vi.fn().mockImplementation(() => ({})),
  FallbackStore: vi
    .fn()
    .mockImplementation(({fallbacks}: {fallbacks: unknown[]}) => fallbacks[0] ?? {}),
  LinkType: {
    Blob: "blob",
    File: "file",
    Dir: "dir",
  },
  HashTree: vi.fn().mockImplementation(() => ({
    readFile: readFileMock,
    listDirectory: listDirectoryMock,
  })),
  nhashDecode: nhashDecodeMock,
  nhashEncode: nhashEncodeMock,
}))

vi.mock("../lib/ndk-cache", () => ({
  db: {
    profiles: {
      put: profilesPutMock,
    },
    cacheData: {
      get: cacheGetMock,
      put: cachePutMock,
    },
  },
}))

async function loadProfileSearchModule() {
  return import("./profile-search")
}

describe("profile search index", () => {
  beforeEach(() => {
    vi.resetModules()
    vi.unstubAllEnvs()
    searchMock.mockReset()
    searchMock.mockResolvedValue([])
    searchLinksMock.mockReset()
    searchLinksMock.mockResolvedValue([])
    readFileMock.mockReset()
    readFileMock.mockResolvedValue(null)
    listDirectoryMock.mockReset()
    listDirectoryMock.mockResolvedValue([])
    cacheGetMock.mockReset()
    cacheGetMock.mockResolvedValue(undefined)
    cachePutMock.mockReset()
    cachePutMock.mockResolvedValue(undefined)
    profilesPutMock.mockReset()
    profilesPutMock.mockResolvedValue(undefined)
    nhashDecodeMock.mockReset()
    nhashDecodeMock.mockImplementation((value: string) => ({
      hash: new Uint8Array([value === "nhash1live" ? 9 : 1]),
      key: new Uint8Array([value === "nhash1live" ? 8 : 2]),
    }))
    nhashEncodeMock.mockReset()
    nhashEncodeMock.mockImplementation((cid: {hash: Uint8Array}) =>
      cid.hash[0] === 9 ? "nhash1live" : "nhash1snapshot"
    )
  })

  it("indexes alias name variants alongside the primary name", async () => {
    const {initSearchIndex, searchProfiles} = await loadProfileSearchModule()

    initSearchIndex([
      {
        pubKey: "pubkey-1",
        name: "sirius",
        aliases: ["Martti Malmi"],
      },
    ])

    const results = await searchProfiles("martti")

    expect(results[0]?.item.pubKey).toBe("pubkey-1")
    expect(results[0]?.item.name).toBe("sirius")
  })

  it("keeps Fuse fuzzy local matches for previously cached profiles", async () => {
    const {initSearchIndex, searchProfiles} = await loadProfileSearchModule()

    initSearchIndex([
      {
        pubKey: "pubkey-mikko",
        name: "Mikko Koljander",
        created_at: 200,
      },
    ])

    const results = await searchProfiles("kajan")

    expect(results[0]?.item.pubKey).toBe("pubkey-mikko")
    expect(results[0]?.item.name).toBe("Mikko Koljander")
  })

  it("does not let an older profile event replace a newer cached name", async () => {
    const {initSearchIndex, searchProfiles, updateSearchIndex} =
      await loadProfileSearchModule()

    initSearchIndex([
      {
        pubKey: "pubkey-1",
        name: "sirius",
        created_at: 200,
      },
    ])

    updateSearchIndex({
      pubKey: "pubkey-1",
      name: "Martti Malmi",
      created_at: 100,
    })

    expect((await searchProfiles("sirius"))[0]?.item.pubKey).toBe("pubkey-1")
    expect(await searchProfiles("martti")).toHaveLength(0)
  })

  it("uses all supported profile name fields while keeping the best display name", () => {
    const searchProfile = buildProfileSearchResult(
      "pubkey-1",
      {
        display_name: "sirius",
        displayName: "Sirius",
        name: "Martti Malmi",
        username: "mmalmi",
        nip05: "siriusdev@iris.to",
        picture: "https://cdn.iris.to/sirius.png",
      },
      200
    )

    expect(searchProfile).toEqual({
      pubKey: "pubkey-1",
      name: "sirius",
      aliases: ["Martti Malmi", "mmalmi"],
      nip05: "siriusdev",
      picture: "https://cdn.iris.to/sirius.png",
      created_at: 200,
    })
  })

  it("treats exact profile term matches as stronger than generic prefix matches", () => {
    expect(
      hasProfileSearchExactMatch(
        {
          name: "jack",
          aliases: ["Jack Dorsey"],
          nip05: "jack",
        },
        "jack"
      )
    ).toBe(true)
    expect(
      hasProfileSearchExactMatch(
        {
          name: "Jackless",
          aliases: ["jackson"],
          nip05: "jackson",
        },
        "jack"
      )
    ).toBe(false)
  })

  it("filters unrelated fuzzy matches that do not actually contain the query text", () => {
    expect(
      hasProfileSearchTextMatch(
        {
          name: "Sirius",
          aliases: ["Martti Malmi"],
          nip05: "siriusdev",
          pubKey: "pubkey-1",
        },
        "petri"
      )
    ).toBe(false)
    expect(
      hasProfileSearchTextMatch(
        {
          name: "Petri Lampinen",
          aliases: ["Petri"],
          nip05: "petri",
          pubKey: "pubkey-2",
        },
        "petri"
      )
    ).toBe(true)
  })

  it("emits immediate remote candidates from existing index keys without reading hashtree value blobs", async () => {
    vi.stubEnv("VITE_PROFILE_SEARCH_INDEX", "nhash1testprofileindex")

    listDirectoryMock.mockImplementation(async (cid: {hash: Uint8Array}) => {
      if (cid.hash[0] !== 1) {
        return []
      }

      return [
        {
          name: "p:mikko:pubkey-mikko",
          type: "blob",
          cid: {hash: new Uint8Array([3]), key: new Uint8Array([4])},
          size: 123,
        },
        {
          name: "p:mila:pubkey-mila",
          type: "blob",
          cid: {hash: new Uint8Array([5]), key: new Uint8Array([6])},
          size: 123,
        },
      ]
    })

    const {initSearchIndex, searchProfiles} = await loadProfileSearchModule()
    initSearchIndex([])

    const results = await searchProfiles("mi")

    expect(results.map((result) => result.item.pubKey)).toEqual([
      "pubkey-mila",
      "pubkey-mikko",
    ])
    expect(results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          item: expect.objectContaining({
            pubKey: "pubkey-mikko",
            name: "",
            aliases: ["mikko"],
          }),
        }),
      ])
    )
    expect(readFileMock).not.toHaveBeenCalled()
    expect(searchMock).not.toHaveBeenCalled()
  })

  it("queries remote hashtree profile search results when the local cache misses", async () => {
    vi.stubEnv("VITE_PROFILE_SEARCH_INDEX", "nhash1testprofileindex")

    searchLinksMock.mockResolvedValue([
      {
        id: "pubkey-remote",
        cid: {hash: new Uint8Array([3]), key: new Uint8Array([4])},
        score: 2,
      },
    ])
    readFileMock.mockResolvedValue(
      new TextEncoder().encode(
        JSON.stringify({
          pubkey: "pubkey-remote",
          created_at: 321,
          content: JSON.stringify({
            display_name: "Remote Sirius",
            nip05: "remote@iris.to",
          }),
        })
      )
    )

    const {initSearchIndex, searchProfiles} = await loadProfileSearchModule()
    initSearchIndex([])

    const first = await searchProfiles("remote")
    const second = await searchProfiles("remote")

    expect(first[0]?.item).toMatchObject({
      pubKey: "pubkey-remote",
      name: "Remote Sirius",
      created_at: 321,
    })
    expect(second[0]?.item.pubKey).toBe("pubkey-remote")
    expect(readFileMock).toHaveBeenCalledTimes(1)
  })

  it("uses a cached tree snapshot first, then refreshes npub/treeName roots when newer data exists", async () => {
    vi.stubEnv("VITE_PROFILE_SEARCH_INDEX", "npub1owner/profile-search")

    cacheGetMock.mockResolvedValue({
      key: "profile-search-root:npub1owner/profile-search",
      data: {
        nhash: "nhash1snapshot",
        eventId: "event-old",
        createdAt: 100,
      },
      cachedAt: Date.now(),
    })

    searchLinksMock.mockImplementation(async (root: {hash: Uint8Array}) => {
      if (root.hash[0] === 1) {
        return []
      }

      return [
        {
          id: "pubkey-live",
          cid: {hash: new Uint8Array([3]), key: new Uint8Array([4])},
          score: 1,
        },
      ]
    })
    readFileMock.mockResolvedValue(
      new TextEncoder().encode(
        JSON.stringify({
          pubkey: "pubkey-live",
          created_at: 456,
          content: JSON.stringify({
            display_name: "Live Derek",
          }),
        })
      )
    )

    const {initSearchIndex, searchProfiles, setRemoteProfileSearchTreeResolver} =
      await loadProfileSearchModule()

    setRemoteProfileSearchTreeResolver(async () => ({
      root: {hash: new Uint8Array([9]), key: new Uint8Array([8])},
      eventId: "event-new",
      createdAt: 200,
    }))
    initSearchIndex([])

    const results = await searchProfiles("derek")

    expect(results[0]?.item).toMatchObject({
      pubKey: "pubkey-live",
      name: "Live Derek",
      created_at: 456,
    })
    expect(searchLinksMock).toHaveBeenCalledTimes(2)
    expect(searchLinksMock.mock.calls[0]?.[0]).toMatchObject({
      hash: new Uint8Array([1]),
      key: new Uint8Array([2]),
    })
    expect(searchLinksMock.mock.calls[1]?.[0]).toMatchObject({
      hash: new Uint8Array([9]),
      key: new Uint8Array([8]),
    })
    expect(cachePutMock).toHaveBeenCalledWith({
      key: "profile-search-root:npub1owner/profile-search",
      data: {
        nhash: "nhash1live",
        eventId: "event-new",
        createdAt: 200,
      },
      cachedAt: expect.any(Number),
    })
  })

  it("uses an env-provided snapshot root for npub/treeName when Dexie has no cached root yet", async () => {
    vi.stubEnv("VITE_PROFILE_SEARCH_INDEX", "npub1owner/profile-search")
    vi.stubEnv("VITE_PROFILE_SEARCH_INDEX_SNAPSHOT", "nhash1snapshot")

    searchLinksMock.mockResolvedValue([
      {
        id: "pubkey-snapshot",
        cid: {hash: new Uint8Array([3]), key: new Uint8Array([4])},
        score: 1,
      },
    ])
    readFileMock.mockResolvedValue(
      new TextEncoder().encode(
        JSON.stringify({
          pubkey: "pubkey-snapshot",
          created_at: 789,
          content: JSON.stringify({
            display_name: "Snapshot Sirius",
          }),
        })
      )
    )

    const {initSearchIndex, searchProfiles, setRemoteProfileSearchTreeResolver} =
      await loadProfileSearchModule()

    setRemoteProfileSearchTreeResolver(async () => null)
    initSearchIndex([])

    const results = await searchProfiles("sirius")

    expect(results[0]?.item).toMatchObject({
      pubKey: "pubkey-snapshot",
      name: "Snapshot Sirius",
      created_at: 789,
    })
    expect(searchLinksMock).toHaveBeenCalledTimes(1)
    expect(searchLinksMock.mock.calls[0]?.[0]).toMatchObject({
      hash: new Uint8Array([1]),
      key: new Uint8Array([2]),
    })
  })

  it("prefers the shipped snapshot over a stale cached root when no live binding is available", async () => {
    vi.stubEnv("VITE_PROFILE_SEARCH_INDEX", "npub1owner/profile-search")
    vi.stubEnv("VITE_PROFILE_SEARCH_INDEX_SNAPSHOT", "nhash1snapshot-new")

    cacheGetMock.mockResolvedValue({
      key: "profile-search-root:npub1owner/profile-search",
      data: {
        nhash: "nhash1cached-old",
        eventId: "event-old",
        createdAt: 100,
      },
      cachedAt: Date.now(),
    })

    nhashDecodeMock.mockImplementation((value: string) => {
      if (value === "nhash1cached-old") {
        return {
          hash: new Uint8Array([7]),
          key: new Uint8Array([6]),
        }
      }

      if (value === "nhash1snapshot-new") {
        return {
          hash: new Uint8Array([1]),
          key: new Uint8Array([2]),
        }
      }

      return {
        hash: new Uint8Array([9]),
        key: new Uint8Array([8]),
      }
    })

    searchLinksMock.mockImplementation(async (root: {hash: Uint8Array}) => {
      if (root.hash[0] !== 1) {
        return []
      }

      return [
        {
          id: "pubkey-petri",
          cid: {hash: new Uint8Array([3]), key: new Uint8Array([4])},
          score: 1,
        },
      ]
    })
    readFileMock.mockResolvedValue(
      new TextEncoder().encode(
        JSON.stringify({
          pubkey: "pubkey-petri",
          created_at: 789,
          content: JSON.stringify({
            display_name: "Petri",
          }),
        })
      )
    )

    const {initSearchIndex, searchProfiles, setRemoteProfileSearchTreeResolver} =
      await loadProfileSearchModule()

    setRemoteProfileSearchTreeResolver(async () => null)
    initSearchIndex([])

    const results = await searchProfiles("petri")

    expect(results[0]?.item).toMatchObject({
      pubKey: "pubkey-petri",
      name: "Petri",
      created_at: 789,
    })
    expect(searchLinksMock).toHaveBeenCalledTimes(1)
    expect(searchLinksMock.mock.calls[0]?.[0]).toMatchObject({
      hash: new Uint8Array([1]),
      key: new Uint8Array([2]),
    })
  })

  it("fetches a wider remote candidate set so jack is not dropped outside the first 20 hits", async () => {
    vi.stubEnv("VITE_PROFILE_SEARCH_INDEX", "nhash1testprofileindex")

    const jackPubKey = String(
      nip19.decode("npub1sg6plzptd64u62a878hep2kev88swjh3tw00gjsfl8f237lmu63q0uf63m").data
    )

    searchLinksMock.mockImplementation(async (_root, _prefix, _query, options) => {
      expect(options).toEqual({limit: 64})

      return Array.from({length: 64}, (_, index) => ({
        id: index === 40 ? jackPubKey : `pubkey-jack-${index}`,
        cid: {
          hash: new Uint8Array([index + 1]),
          key: new Uint8Array([index + 101]),
        },
        score: index,
      }))
    })

    readFileMock.mockImplementation(async (cid: {hash: Uint8Array}) => {
      const index = cid.hash[0] - 1
      if (index === 40) {
        return new TextEncoder().encode(
          JSON.stringify({
            pubkey: jackPubKey,
            created_at: 500,
            content: JSON.stringify({
              display_name: "jack",
              name: "Jack Dorsey",
              nip05: "jack@cash.app",
            }),
          })
        )
      }

      return new TextEncoder().encode(
        JSON.stringify({
          pubkey: `pubkey-jack-${index}`,
          created_at: 100,
          content: JSON.stringify({
            display_name: `jack fan ${index}`,
          }),
        })
      )
    })

    const {initSearchIndex, searchProfiles} = await loadProfileSearchModule()
    initSearchIndex([])

    const results = await searchProfiles("jack")

    expect(results.some((result) => result.item.pubKey === jackPubKey)).toBe(true)
  })

  it("uses a smaller remote candidate window for very short queries", async () => {
    vi.stubEnv("VITE_PROFILE_SEARCH_INDEX", "nhash1testprofileindex")

    searchMock.mockImplementation(async (_root, _prefix, query, options) => {
      if (query === "mi") {
        expect(options).toEqual({limit: 8})
      } else if (query === "mik") {
        expect(options).toEqual({limit: 16})
      } else {
        expect(options).toEqual({limit: 64})
      }

      return [
        {
          id: `pubkey-${query}`,
          value: JSON.stringify({
            pubkey: `pubkey-${query}`,
            name: `name-${query}`,
            created_at: 123,
          }),
          score: 1,
        },
      ]
    })

    const {initSearchIndex, searchProfiles} = await loadProfileSearchModule()
    initSearchIndex([])

    await searchProfiles("mi")
    await searchProfiles("mik")
    await searchProfiles("mikk")
  })

  it("emits local search results before the delayed remote lookup finishes", async () => {
    vi.stubEnv("VITE_PROFILE_SEARCH_INDEX", "nhash1testprofileindex")

    let resolveRemoteProfile: ((value: Uint8Array) => void) | null = null

    searchLinksMock.mockResolvedValue([
      {
        id: "pubkey-remote",
        cid: {
          hash: new Uint8Array([1]),
          key: new Uint8Array([101]),
        },
        score: 2,
      },
    ])

    readFileMock.mockImplementation(
      async () =>
        new Promise<Uint8Array>((resolve) => {
          resolveRemoteProfile = resolve
        })
    )

    const {initSearchIndex, searchProfilesWithProgress} = await loadProfileSearchModule()
    initSearchIndex([
      {
        pubKey: "pubkey-local",
        name: "mil local",
        created_at: 50,
      },
    ])

    const updates: string[][] = []
    let completed = false
    const pending = searchProfilesWithProgress("mil", (results) => {
      updates.push(results.map((result) => result.item.pubKey))
    }).then((results) => {
      completed = true
      return results
    })

    await vi.waitFor(() => {
      expect(completed).toBe(false)
      expect(updates).toContainEqual(["pubkey-local"])
    })

    await vi.waitFor(() => {
      expect(readFileMock).toHaveBeenCalledTimes(1)
      expect(resolveRemoteProfile).toBeTypeOf("function")
    })

    resolveRemoteProfile!(
      new TextEncoder().encode(
        JSON.stringify({
          pubkey: "pubkey-remote",
          created_at: 120,
          content: JSON.stringify({
            display_name: "mil remote",
          }),
        })
      )
    )

    const results = await pending

    expect(results).toHaveLength(2)
    expect(results.map((result) => result.item.pubKey)).toEqual([
      "pubkey-local",
      "pubkey-remote",
    ])
  })

  it("renders remote metadata hits immediately and hydrates mirrored events in the background", async () => {
    vi.stubEnv("VITE_PROFILE_SEARCH_INDEX", "nhash1testprofileindex")

    let resolveRemoteEvent: ((value: Uint8Array) => void) | null = null

    searchMock.mockResolvedValue([
      {
        id: "pubkey-petri",
        value: JSON.stringify({
          pubkey: "pubkey-petri",
          name: "Petri",
          aliases: ["Petri Repo"],
          nip05: "petri",
          created_at: 111,
          event_nhash: "nhash1event",
        }),
        score: 2,
      },
    ])
    nhashDecodeMock.mockImplementation((value: string) => {
      if (value === "nhash1event") {
        return {
          hash: new Uint8Array([7]),
          key: new Uint8Array([8]),
        }
      }
      return {
        hash: new Uint8Array([1]),
        key: new Uint8Array([2]),
      }
    })
    readFileMock.mockImplementation(
      async () =>
        new Promise<Uint8Array>((resolve) => {
          resolveRemoteEvent = resolve
        })
    )

    const {initSearchIndex, searchProfilesWithProgress} = await loadProfileSearchModule()
    initSearchIndex([])

    const updates: Array<
      Array<{
        pubKey: string
        name: string
        picture?: string
        nip05?: string
        created_at?: number
      }>
    > = []
    const results = await searchProfilesWithProgress("petri", (hits) => {
      updates.push(
        hits.map((hit) => ({
          pubKey: hit.item.pubKey,
          name: hit.item.name,
          picture: hit.item.picture,
          nip05: hit.item.nip05,
          created_at: hit.item.created_at,
        }))
      )
    })

    expect(results).toHaveLength(1)
    expect(results[0]?.item).toMatchObject({
      pubKey: "pubkey-petri",
      name: "Petri",
      aliases: ["Petri Repo"],
      nip05: "petri",
      created_at: 111,
    })
    expect(updates).toContainEqual([
      {
        pubKey: "pubkey-petri",
        name: "Petri",
        picture: undefined,
        nip05: "petri",
        created_at: 111,
      },
    ])
    expect(readFileMock).toHaveBeenCalledTimes(1)

    resolveRemoteEvent!(
      new TextEncoder().encode(
        JSON.stringify({
          pubkey: "pubkey-petri",
          created_at: 222,
          content: JSON.stringify({
            display_name: "Petri",
            name: "Petri Repo",
            nip05: "petri@example.com",
            picture: "https://cdn.iris.to/petri.png",
          }),
        })
      )
    )

    await vi.waitFor(() => {
      expect(updates).toContainEqual([
        {
          pubKey: "pubkey-petri",
          name: "Petri",
          picture: "https://cdn.iris.to/petri.png",
          nip05: "petri",
          created_at: 222,
        },
      ])
    })
  })

  it("feeds remote metadata hits back into the local Fuse index for later fuzzy queries", async () => {
    vi.stubEnv("VITE_PROFILE_SEARCH_INDEX", "nhash1testprofileindex")

    searchMock.mockImplementation(async (_root, _prefix, query) => {
      if (query === "mikk") {
        return [
          {
            id: "pubkey-mikko",
            value: JSON.stringify({
              pubkey: "pubkey-mikko",
              name: "Mikko Koljander",
              created_at: 222,
            }),
            score: 2,
          },
        ]
      }
      return []
    })

    const {initSearchIndex, searchProfiles} = await loadProfileSearchModule()
    initSearchIndex([])

    const firstResults = await searchProfiles("mikk")
    expect(firstResults[0]?.item).toMatchObject({
      pubKey: "pubkey-mikko",
      name: "Mikko Koljander",
    })

    const fuzzyResults = await searchProfiles("kajan")
    expect(fuzzyResults[0]?.item).toMatchObject({
      pubKey: "pubkey-mikko",
      name: "Mikko Koljander",
    })
  })
})
