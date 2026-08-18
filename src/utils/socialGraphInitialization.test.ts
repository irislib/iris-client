import {expect, it, vi} from "vitest"

const storage = vi.hoisted(() => ({
  getItem: vi.fn().mockRejectedValue(new Error("IndexedDB unavailable")),
  removeItem: vi.fn(),
  setItem: vi.fn(),
}))

vi.mock("localforage", () => ({default: storage}))

it("settles graph readiness when persisted storage fails", async () => {
  const {DEFAULT_SOCIAL_GRAPH_ROOT, getSocialGraph, socialGraphLoaded} =
    await import("./socialGraph")

  await expect(socialGraphLoaded).resolves.toBe(true)
  expect(storage.getItem).toHaveBeenCalledWith("socialGraph")
  expect(getSocialGraph()).toBeDefined()
  expect(getSocialGraph().getRoot()).toBe(DEFAULT_SOCIAL_GRAPH_ROOT)
})
