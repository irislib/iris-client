/** @vitest-environment jsdom */

import React, {act} from "react"
import {createRoot, Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {DoubleRatchetUserSearch} from "./DoubleRatchetUserSearch"

const mocks = vi.hoisted(() => ({
  count: 0,
  search: vi.fn(),
}))

vi.mock("../hooks/useDoubleRatchetUsers", () => ({
  useDoubleRatchetUsers: () => ({
    count: mocks.count,
    search: mocks.search,
  }),
}))

vi.mock("@/shared/components/user/UserRow", () => ({
  UserRow: ({pubKey}: {pubKey: string}) => React.createElement("div", null, pubKey),
}))

describe("DoubleRatchetUserSearch", () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ;(
      globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}
    ).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)

    mocks.count = 1
    mocks.search.mockReset()
    mocks.search.mockReturnValue([])
  })

  afterEach(async () => {
    await act(async () => {
      root.unmount()
    })
    container.remove()
  })

  it("submits pasted raw input without requiring Enter", async () => {
    const onRawInputSubmit = vi.fn().mockResolvedValue(true)

    await act(async () => {
      root.render(
        React.createElement(DoubleRatchetUserSearch, {
          onUserSelect: vi.fn(),
          onRawInputSubmit,
        })
      )
    })

    const input = container.querySelector("input")
    if (!input) throw new Error("input not found")

    const pastedInvite = "https://iris.to/#invite"
    const inputEvent = new Event("input", {bubbles: true}) as Event & {
      inputType?: string
    }
    inputEvent.inputType = "insertFromPaste"

    await act(async () => {
      input.value = pastedInvite
      input.dispatchEvent(inputEvent)
      await Promise.resolve()
    })

    expect(onRawInputSubmit).toHaveBeenCalledTimes(1)
    expect(onRawInputSubmit).toHaveBeenCalledWith(pastedInvite)
  })

  it("does not submit raw input while typing normally", async () => {
    const onRawInputSubmit = vi.fn().mockResolvedValue(true)

    await act(async () => {
      root.render(
        React.createElement(DoubleRatchetUserSearch, {
          onUserSelect: vi.fn(),
          onRawInputSubmit,
        })
      )
    })

    const input = container.querySelector("input")
    if (!input) throw new Error("input not found")

    const inputEvent = new Event("input", {bubbles: true}) as Event & {
      inputType?: string
    }
    inputEvent.inputType = "insertText"

    await act(async () => {
      input.value = "hello"
      input.dispatchEvent(inputEvent)
      await Promise.resolve()
    })

    expect(onRawInputSubmit).not.toHaveBeenCalled()
  })
})
