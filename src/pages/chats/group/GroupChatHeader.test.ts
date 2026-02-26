/** @vitest-environment jsdom */

import React, {act} from "react"
import {createRoot, Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import GroupChatHeader from "./GroupChatHeader"

const mocks = vi.hoisted(() => ({
  groupsStore: {
    groups: {},
    removeGroup: vi.fn(),
  },
  navigate: vi.fn(),
  resolvedPictureUrl: null as string | null,
  confirm: vi.fn(),
}))

vi.mock("@/stores/groups", () => ({
  useGroupsStore: () => mocks.groupsStore,
}))

vi.mock("@/navigation", () => ({
  useNavigate: () => mocks.navigate,
}))

vi.mock("@/shared/components/Navigate", () => ({
  Navigate: ({
    children,
    to,
    className,
  }: {
    children: React.ReactNode
    to: string
    className?: string
  }) => React.createElement("a", {href: to, className}, children),
}))

vi.mock("@/shared/components/header/Header", () => ({
  default: ({children}: {children: React.ReactNode}) =>
    React.createElement("div", {"data-testid": "header"}, children),
}))

vi.mock("@/shared/components/ui/Dropdown", () => ({
  default: ({children}: {children: React.ReactNode}) =>
    React.createElement("div", {"data-testid": "dropdown"}, children),
}))

vi.mock("@/utils/utils", () => ({
  confirm: (...args: unknown[]) => mocks.confirm(...args),
}))

vi.mock("./components", () => ({
  GroupAvatar: ({picture}: {picture?: string}) =>
    React.createElement("div", {
      "data-testid": "group-avatar",
      "data-picture": picture ?? "",
    }),
}))

vi.mock("./components/useGroupPictureUrl", () => ({
  useGroupPictureUrl: () => mocks.resolvedPictureUrl,
}))

vi.mock("@/shared/components/media/MediaModal", () => ({
  default: ({mediaUrl}: {mediaUrl?: string}) =>
    React.createElement("div", {
      "data-testid": "media-modal",
      "data-media-url": mediaUrl ?? "",
    }),
}))

describe("GroupChatHeader", () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ;(
      globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}
    ).IS_REACT_ACT_ENVIRONMENT = true

    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)

    mocks.groupsStore = {
      groups: {
        "group-1": {
          id: "group-1",
          name: "Test Group",
          description: "Description",
          picture: "nhash://group-picture",
        },
      },
      removeGroup: vi.fn(),
    }
    mocks.navigate = vi.fn()
    mocks.resolvedPictureUrl = "blob:group-picture"
    mocks.confirm = vi.fn().mockResolvedValue(true)
  })

  afterEach(async () => {
    await act(async () => {
      root.unmount()
    })
    container.remove()
  })

  it("opens media modal when group avatar is clicked", async () => {
    await act(async () => {
      root.render(React.createElement(GroupChatHeader, {groupId: "group-1"}))
    })

    const avatarButton = container.querySelector(
      'button[aria-label="Open group picture"]'
    )
    expect(avatarButton).toBeTruthy()

    await act(async () => {
      avatarButton?.dispatchEvent(new MouseEvent("click", {bubbles: true}))
    })

    const modal = container.querySelector('[data-testid="media-modal"]')
    expect(modal).toBeTruthy()
    expect(modal?.getAttribute("data-media-url")).toBe("blob:group-picture")
  })
})
