// @vitest-environment jsdom
import {beforeEach, describe, expect, it} from "vitest"
import {useContactMemoryStore} from "./contactMemory"

describe("private contact memory", () => {
  beforeEach(() => {
    useContactMemoryStore.setState({accounts: {}, latestNames: {}})
  })

  it("keeps the first name until the exact proposed name is approved", () => {
    const store = useContactMemoryStore.getState()
    store.observeProfile("friend", "Alice", 1)
    store.remember("me", "friend")
    store.observeProfile("friend", "Alicia", 2)
    expect(useContactMemoryStore.getState().accounts.me.friend.accepted_name).toBe(
      "Alice"
    )
    store.approveName("me", "friend", "Alicia", 100)
    expect(useContactMemoryStore.getState().accounts.me.friend).toEqual({
      first_seen_name: "Alice",
      accepted_name: "Alicia",
      favorite: false,
      name_changes: [
        {previous_name: "Alice", accepted_name: "Alicia", accepted_at_secs: 100},
      ],
    })
  })

  it("rejects stale approvals and older profile results", () => {
    const store = useContactMemoryStore.getState()
    store.observeProfile("friend", "Alice", 1)
    store.remember("me", "friend")
    store.observeProfile("friend", "Alicia", 3)
    store.observeProfile("friend", "Mallory", 4)
    store.observeProfile("friend", "Alicia", 2)
    store.approveName("me", "friend", "Alicia", 100)
    expect(useContactMemoryStore.getState().accounts.me.friend.accepted_name).toBe(
      "Alice"
    )
    expect(useContactMemoryStore.getState().accounts.me.friend.name_changes).toEqual([])
  })

  it("waits for an actual name, and does not remember passive profile views", () => {
    const store = useContactMemoryStore.getState()
    store.remember("me", "friend")
    store.observeProfile("stranger", "Stranger", 1)
    expect(useContactMemoryStore.getState().accounts.me.stranger).toBeUndefined()
    store.observeProfile("friend", "Alice", 1)
    expect(useContactMemoryStore.getState().accounts.me.friend.first_seen_name).toBe(
      "Alice"
    )
    store.observeProfile("friend", null, 2)
    expect(useContactMemoryStore.getState().accounts.me.friend.accepted_name).toBe(
      "Alice"
    )
  })

  it("keeps favorites and accepted names private to each account across persistence", async () => {
    const store = useContactMemoryStore.getState()
    store.observeProfile("friend", "Alice", 1)
    store.setFavorite("me", "friend", true)
    store.observeProfile("friend", "Alicia", 2)
    store.remember("other-account", "friend")
    const persisted = localStorage.getItem("contact-memory-storage")!
    expect(persisted).not.toContain("latestNames")
    useContactMemoryStore.setState({accounts: {}, latestNames: {}})
    localStorage.setItem("contact-memory-storage", persisted)
    await useContactMemoryStore.persist.rehydrate()
    expect(useContactMemoryStore.getState().accounts.me.friend.favorite).toBe(true)
    expect(useContactMemoryStore.getState().accounts.me.friend.accepted_name).toBe(
      "Alice"
    )
    expect(
      useContactMemoryStore.getState().accounts["other-account"].friend.accepted_name
    ).toBe("Alicia")
    expect(
      useContactMemoryStore.getState().accounts["other-account"].friend.favorite
    ).toBe(false)
  })
})
