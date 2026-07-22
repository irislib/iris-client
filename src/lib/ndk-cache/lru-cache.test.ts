import createDebug from "debug"
import {describe, expect, it} from "vitest"
import {CacheHandler} from "./lru-cache.js"

type Entry = {kind: number; value: string}

describe("CacheHandler indexes", () => {
  it("tracks zero values, updates, deletion, and LRU eviction", () => {
    const cache = new CacheHandler<Entry>({
      maxSize: 2,
      dump: async () => {},
      debug: createDebug("cache-handler-test"),
    })
    cache.addIndex("kind")

    cache.set("zero", {kind: 0, value: "zero"}, false)
    expect([...cache.getFromIndex("kind", 0)]).toEqual([{kind: 0, value: "zero"}])

    cache.set("zero", {kind: 1, value: "updated"}, false)
    expect(cache.getFromIndex("kind", 0).size).toBe(0)
    expect(cache.getFromIndex("kind", 1).size).toBe(1)

    cache.set("second", {kind: 1, value: "second"}, false)
    cache.set("third", {kind: 1, value: "third"}, false)
    expect(cache.indexes.get("kind")?.get(1)?.size).toBe(2)

    cache.delete("second")
    expect(cache.indexes.get("kind")?.get(1)?.size).toBe(1)
  })
})
