import React from "react"
import {renderToStaticMarkup} from "react-dom/server"
import {describe, expect, it, vi} from "vitest"

vi.mock("./Avatar", () => ({
  Avatar: (props: {fallbackProfile?: {picture?: string}}) =>
    React.createElement("div", {
      "data-testid": "avatar",
      "data-picture": props.fallbackProfile?.picture || "",
    }),
}))

vi.mock("./Name", () => ({
  Name: (props: {fallbackProfile?: {name?: string}}) =>
    React.createElement("span", {"data-testid": "name"}, props.fallbackProfile?.name || ""),
}))

vi.mock("./ProfileLink", () => ({
  ProfileLink: ({children}: {children: React.ReactNode}) =>
    React.createElement("div", null, children),
}))

vi.mock("./ProfileCard", () => ({
  default: () => null,
}))

vi.mock("./useHoverCard", () => ({
  useHoverCard: () => ({
    hoverProps: {},
    showCard: false,
    cardRef: {current: null},
  }),
}))

import {UserRow} from "./UserRow"

describe("UserRow", () => {
  it("passes fallback search-hit profile data through to the rendered row", () => {
    const html = renderToStaticMarkup(
      React.createElement(UserRow, {
        pubKey: "0000000000000000000000000000000000000000000000000000000000000001",
        linkToProfile: false,
        fallbackProfile: {
          name: "Mikk",
          picture: "https://cdn.iris.to/mikk.png",
        },
      })
    )

    expect(html).toContain("Mikk")
    expect(html).toContain("https://cdn.iris.to/mikk.png")
  })
})
