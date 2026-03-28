import {beforeEach, describe, expect, it} from "vitest"

import {initSearchIndex, searchProfiles, updateSearchIndex} from "./profile-search"
import {buildProfileSearchResult} from "../utils/profileSearchData"

describe("profile search index", () => {
  beforeEach(() => {
    initSearchIndex([])
  })

  it("indexes alias name variants alongside the primary name", () => {
    initSearchIndex([
      {
        pubKey: "pubkey-1",
        name: "sirius",
        aliases: ["Martti Malmi"],
      },
    ])

    const results = searchProfiles("martti")

    expect(results[0]?.item.pubKey).toBe("pubkey-1")
    expect(results[0]?.item.name).toBe("sirius")
  })

  it("does not let an older profile event replace a newer cached name", () => {
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

    expect(searchProfiles("sirius")[0]?.item.pubKey).toBe("pubkey-1")
    expect(searchProfiles("martti")).toHaveLength(0)
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
      },
      200
    )

    expect(searchProfile).toEqual({
      pubKey: "pubkey-1",
      name: "sirius",
      aliases: ["Martti Malmi", "mmalmi"],
      nip05: "siriusdev",
      created_at: 200,
    })
  })
})
