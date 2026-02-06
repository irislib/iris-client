import React from "react"
import {renderToStaticMarkup} from "react-dom/server"
import {describe, expect, it} from "vitest"

import MessageStatus from "./MessageStatus"

const getClassList = (html: string): string[] => {
  const match = html.match(/class=\"([^\"]*)\"/)
  if (!match) return []
  return match[1].split(/\s+/).filter(Boolean)
}

const getPathD = (html: string): string | undefined => {
  const match = html.match(/<path d=\"([^\"]+)\"/)
  return match?.[1]
}

describe("MessageStatus", () => {
  it("does not hardcode primary text color for seen (must remain visible on bg-primary bubbles)", () => {
    const html = renderToStaticMarkup(React.createElement(MessageStatus, {status: "seen"}))
    const classes = getClassList(html)

    // `text-primary` equals the bubble background for our messages (`bg-primary`), making it invisible.
    expect(classes.some((c) => /^text-primary(\/|$)/.test(c))).toBe(false)
  })

  it("renders double-check marks for delivered (and no info/blue tint)", () => {
    const seenHtml = renderToStaticMarkup(
      React.createElement(MessageStatus, {status: "seen"})
    )
    const deliveredHtml = renderToStaticMarkup(
      React.createElement(MessageStatus, {status: "delivered"})
    )

    // Delivered should render the same icon as "seen" (double-checks),
    // but without the info/blue tint.
    expect(getPathD(deliveredHtml)).toEqual(getPathD(seenHtml))
    expect(getClassList(deliveredHtml)).not.toContain("text-info")
  })

  it("renders a single check mark when sentToRelays is true and there is no receipt yet", () => {
    const deliveredHtml = renderToStaticMarkup(
      React.createElement(MessageStatus, {status: "delivered"})
    )
    const sentHtml = renderToStaticMarkup(
      React.createElement(MessageStatus, {sentToRelays: true})
    )

    expect(getPathD(sentHtml)).toBeTruthy()
    expect(getPathD(sentHtml)).not.toEqual(getPathD(deliveredHtml))
  })
})
