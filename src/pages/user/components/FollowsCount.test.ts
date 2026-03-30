/** @vitest-environment jsdom */

import React, {act} from "react"
import {createRoot, Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

const mocks = vi.hoisted(() => ({
  follows: [] as string[],
  myPubKey: "viewer-pubkey",
  socialGraph: {
    getFollowedByUser: vi.fn(() => new Set<string>()),
  },
  followListProps: [] as Array<{follows?: string[]}>,
}))

vi.mock("@/shared/hooks/useFollows.ts", () => ({
  default: () => mocks.follows,
}))

vi.mock("@/stores/user", () => ({
  usePublicKey: () => mocks.myPubKey,
}))

vi.mock("@/utils/socialGraph", () => ({
  useSocialGraph: () => mocks.socialGraph,
}))

vi.mock("@/shared/components/ui/Modal", () => ({
  default: ({children}: {children: React.ReactNode; onClose: () => void}) =>
    React.createElement("div", {"data-testid": "modal"}, children),
}))

vi.mock("./FollowList.tsx", () => ({
  default: (props: {follows?: string[]}) => {
    mocks.followListProps.push(props)
    return React.createElement(
      "div",
      {"data-testid": "follow-list"},
      props.follows?.join(",")
    )
  },
}))

vi.mock("@/shared/components/user/Avatar", () => ({
  Avatar: () => React.createElement("div", null),
}))

vi.mock("@/shared/components/user/Name", () => ({
  Name: () => React.createElement("div", null),
}))

import FollowsCount from "./FollowsCount"

describe("FollowsCount", () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ;(
      globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}
    ).IS_REACT_ACT_ENVIRONMENT = true

    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
    mocks.follows = []
    mocks.followListProps = []
    mocks.socialGraph.getFollowedByUser.mockClear()
  })

  afterEach(async () => {
    await act(async () => {
      root.unmount()
    })
    container.remove()
  })

  it("uses the relay-backed follows array for both the count and the modal list", async () => {
    mocks.follows = ["pubkey-1", "pubkey-2"]

    await act(async () => {
      root.render(React.createElement(FollowsCount, {pubKey: "author-pubkey"}))
    })

    expect(container.textContent).toContain("2")
    expect(container.textContent).toContain("follows")

    const button = container.querySelector("button")
    expect(button).not.toBeNull()

    await act(async () => {
      button?.dispatchEvent(new MouseEvent("click", {bubbles: true}))
    })

    expect(container.querySelector('[data-testid="follow-list"]')?.textContent).toBe(
      "pubkey-1,pubkey-2"
    )
    expect(mocks.followListProps.at(-1)?.follows).toEqual(["pubkey-1", "pubkey-2"])
  })
})
