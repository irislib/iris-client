/** @vitest-environment jsdom */

import {act} from "react"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"
import InfiniteScroll from "./InfiniteScroll"

;(
  globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}
).IS_REACT_ACT_ENVIRONMENT = true

class FakeIntersectionObserver {
  static instances: FakeIntersectionObserver[] = []
  private callback: (entries: IntersectionObserverEntry[]) => void

  constructor(callback: (entries: IntersectionObserverEntry[]) => void) {
    this.callback = callback
    FakeIntersectionObserver.instances.push(this)
  }

  observe = vi.fn()
  unobserve = vi.fn()
  disconnect = vi.fn()
  takeRecords = vi.fn(() => [])
  root = null
  rootMargin = ""
  thresholds = []

  trigger(isIntersecting: boolean) {
    this.callback([{isIntersecting} as IntersectionObserverEntry])
  }
}

describe("InfiniteScroll", () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    FakeIntersectionObserver.instances = []
    vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver)
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
  })

  it("loads once per intersection even when its callback changes during loading", async () => {
    const firstLoad = vi.fn()
    const nextLoad = vi.fn()

    await act(async () => {
      root.render(
        <InfiniteScroll onLoadMore={firstLoad}>
          <p>post</p>
        </InfiniteScroll>
      )
    })

    FakeIntersectionObserver.instances.at(-1)?.trigger(true)
    expect(firstLoad).toHaveBeenCalledOnce()

    await act(async () => {
      root.render(
        <InfiniteScroll onLoadMore={nextLoad}>
          <p>post</p>
        </InfiniteScroll>
      )
    })

    FakeIntersectionObserver.instances.at(-1)?.trigger(true)
    expect(nextLoad).not.toHaveBeenCalled()

    FakeIntersectionObserver.instances.at(-1)?.trigger(false)
    FakeIntersectionObserver.instances.at(-1)?.trigger(true)
    expect(nextLoad).toHaveBeenCalledOnce()
  })
})
