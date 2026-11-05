import {afterEach, expect, it, vi} from "vitest"

const storage = vi.hoisted(() => ({
  getItem: vi.fn().mockRejectedValue(new Error("IndexedDB unavailable")),
  removeItem: vi.fn(),
  setItem: vi.fn(),
}))

vi.mock("localforage", () => ({default: storage}))
vi.mock("@/stores/user", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/stores/user")>()
  // This graph test starts after user settings hydration, as app startup does.
  actual.useUserStore.setState({awaitHydration: async () => {}})
  return actual
})
afterEach(() => vi.unstubAllGlobals())

it("settles graph readiness when persisted storage fails", async () => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Offline")))
  const {DEFAULT_SOCIAL_GRAPH_ROOT, getSocialGraph, socialGraphLoaded} =
    await import("./socialGraph")

  await expect(socialGraphLoaded).resolves.toBe(true)
  expect(storage.getItem).toHaveBeenCalledWith("socialGraph")
  expect(getSocialGraph()).toBeDefined()
  expect(getSocialGraph().getRoot()).toBe(DEFAULT_SOCIAL_GRAPH_ROOT)
})
