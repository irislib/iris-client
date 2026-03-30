/** @vitest-environment jsdom */

import React, {act} from "react"
import {createRoot, Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

const mocks = vi.hoisted(() => ({
  getProfile: vi.fn(async (pubkey: string) => ({
    pubkey,
    name: `User ${pubkey.slice(-4)}`,
  })),
  subscription: {
    on: vi.fn(),
    stop: vi.fn(),
  },
}))

vi.mock("@/lib/ndk-cache/db", () => ({
  getMainThreadDb: () => ({
    profiles: {
      get: mocks.getProfile,
    },
  }),
}))

vi.mock("@/utils/ndk", () => ({
  ndk: () => ({
    subscribe: vi.fn(() => mocks.subscription),
  }),
}))

vi.mock("@/utils/profileName", () => ({
  updateNameCache: vi.fn(),
}))

vi.mock("@/utils/profileSearch", () => ({
  handleProfile: vi.fn(),
}))

vi.mock("@/utils/usernameCache", () => ({
  addUsernameToCache: vi.fn(),
}))

import useProfile from "./useProfile"

function makePubKey(index: number) {
  return index.toString(16).padStart(64, "0")
}

function ProfileName({pubKey}: {pubKey: string}) {
  const profile = useProfile(pubKey, false)

  return React.createElement("span", {"data-pubkey": pubKey}, profile?.name || "")
}

function ProfileJson({pubKey}: {pubKey: string}) {
  const profile = useProfile(pubKey, false)

  return React.createElement(
    "pre",
    {"data-testid": "profile-json"},
    JSON.stringify(profile || {})
  )
}

function Profiles({pubKeys, tick}: {pubKeys: string[]; tick: number}) {
  return React.createElement(
    "div",
    {"data-tick": tick},
    pubKeys.map((pubKey) => React.createElement(ProfileName, {key: pubKey, pubKey}))
  )
}

describe("useProfile", () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ;(
      globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}
    ).IS_REACT_ACT_ENVIRONMENT = true

    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
    mocks.getProfile.mockClear()
  })

  afterEach(async () => {
    await act(async () => {
      root.unmount()
    })
    container.remove()
  })

  it("keeps already loaded profiles available across rerenders when many rows mount", async () => {
    const pubKeys = Array.from({length: 150}, (_, index) => makePubKey(index + 1))
    const firstPubKey = pubKeys[0]

    await act(async () => {
      root.render(React.createElement(Profiles, {pubKeys, tick: 0}))
    })

    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(container.querySelector(`[data-pubkey="${firstPubKey}"]`)?.textContent).toBe(
      `User ${firstPubKey.slice(-4)}`
    )

    await act(async () => {
      root.render(React.createElement(Profiles, {pubKeys, tick: 1}))
    })

    expect(container.querySelector(`[data-pubkey="${firstPubKey}"]`)?.textContent).toBe(
      `User ${firstPubKey.slice(-4)}`
    )
  })

  it("keeps only the UI-relevant profile fields in memory", async () => {
    const pubKey = makePubKey(999)
    mocks.getProfile.mockResolvedValueOnce({
      pubkey: pubKey,
      name: "Large Profile",
      displayName: "Large Profile Display",
      profileEvent: '{"kind":0,"content":"...huge raw event..."}',
      customBlob: "x".repeat(1024),
    })

    await act(async () => {
      root.render(React.createElement(ProfileJson, {pubKey}))
    })

    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    const json =
      container.querySelector('[data-testid="profile-json"]')?.textContent || ""

    expect(json).toContain('"name":"Large Profile"')
    expect(json).toContain('"displayName":"Large Profile Display"')
    expect(json).not.toContain("profileEvent")
    expect(json).not.toContain("customBlob")
  })
})
