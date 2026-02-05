import React from "react"
import {renderToStaticMarkup} from "react-dom/server"
import {describe, expect, it} from "vitest"

import MessageStatus from "./MessageStatus"

const getClassList = (html: string): string[] => {
  const match = html.match(/class=\"([^\"]*)\"/)
  if (!match) return []
  return match[1].split(/\s+/).filter(Boolean)
}

describe("MessageStatus", () => {
  it("does not hardcode primary text color for seen (must remain visible on bg-primary bubbles)", () => {
    const html = renderToStaticMarkup(React.createElement(MessageStatus, {status: "seen"}))
    const classes = getClassList(html)

    // `text-primary` equals the bubble background for our messages (`bg-primary`), making it invisible.
    expect(classes.some((c) => /^text-primary(\/|$)/.test(c))).toBe(false)
  })
})
