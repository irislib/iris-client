/** @vitest-environment jsdom */

import React, {act} from "react"
import {createRoot, Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

const mocks = vi.hoisted(() => {
  let resolveQuery: ((value: {pubkey: string} | null) => void) | null = null

  return {
    navigation: {
      pathname: "/npub1example",
      navigate: vi.fn(),
    },
    stack: {
      isTopOfStack: true,
    },
    nip05: {
      queryProfile: vi.fn(
        () =>
          new Promise<{pubkey: string} | null>((resolve) => {
            resolveQuery = resolve
          })
      ),
      resolveQuery(value: {pubkey: string} | null) {
        resolveQuery?.(value)
      },
    },
  }
})

vi.mock("@/navigation", () => ({
  useLocation: () => ({pathname: mocks.navigation.pathname}),
  useNavigate: () => mocks.navigation.navigate,
}))

vi.mock("@/navigation/useIsTopOfStack", () => ({
  useIsTopOfStack: () => mocks.stack.isTopOfStack,
}))

vi.mock("nostr-tools", () => ({
  nip05: {
    queryProfile: mocks.nip05.queryProfile,
  },
  nip19: {
    decode: vi.fn((value: string) => ({data: value})),
  },
}))

vi.mock("@/shared/hooks/useMutes", () => ({
  default: () => [],
}))

vi.mock("@/shared/components/HyperText.tsx", () => ({
  default: ({children}: {children: React.ReactNode}) =>
    React.createElement("div", null, children),
}))

vi.mock("@/shared/components/user/MutedBy", () => ({
  default: () => null,
}))

vi.mock("@/shared/components/Icons/Icon", () => ({
  default: () => null,
}))

vi.mock("@/shared/services/Mute", () => ({
  unmuteUser: vi.fn(),
}))

vi.mock("@/pages/Page404", () => ({
  Page404: () => React.createElement("div", null, "404"),
}))

import ProfileDetails from "./ProfileDetails"

describe("ProfileDetails iris.to redirect", () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ;(
      globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}
    ).IS_REACT_ACT_ENVIRONMENT = true

    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)

    mocks.navigation.pathname = "/npub1example"
    mocks.navigation.navigate.mockReset()
    mocks.stack.isTopOfStack = true
    mocks.nip05.queryProfile.mockClear()
  })

  afterEach(async () => {
    await act(async () => {
      root.unmount()
    })
    container.remove()
  })

  it("does not redirect after the view leaves the top of the stack before nip05 resolves", async () => {
    await act(async () => {
      root.render(
        React.createElement(ProfileDetails, {
          displayProfile: {
            name: "sirius",
            nip05: "sirius@iris.to",
          },
          externalIdentities: undefined,
          pubKey: "npub1example",
        })
      )
    })

    expect(mocks.nip05.queryProfile).toHaveBeenCalledWith("sirius@iris.to")

    mocks.stack.isTopOfStack = false
    mocks.navigation.pathname = "/u"

    await act(async () => {
      root.render(
        React.createElement(ProfileDetails, {
          displayProfile: {
            name: "sirius",
            nip05: "sirius@iris.to",
          },
          externalIdentities: undefined,
          pubKey: "npub1example",
        })
      )
    })

    await act(async () => {
      mocks.nip05.resolveQuery({pubkey: "pubkey-1"})
      await Promise.resolve()
    })

    expect(mocks.navigation.navigate).not.toHaveBeenCalled()
  })
})
