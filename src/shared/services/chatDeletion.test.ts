import {describe, expect, it, vi} from "vitest"

import {deletePrivateChat} from "./chatDeletion"

describe("deletePrivateChat", () => {
  it("uses SessionManager.deleteChat when available", async () => {
    const deleteChat = vi.fn().mockResolvedValue(undefined)
    const deleteUser = vi.fn().mockResolvedValue(undefined)
    const manager = {deleteChat, deleteUser}

    await deletePrivateChat(manager, "peer-pubkey")

    expect(deleteChat).toHaveBeenCalledTimes(1)
    expect(deleteChat).toHaveBeenCalledWith("peer-pubkey")
    expect(deleteUser).not.toHaveBeenCalled()
  })

  it("falls back to deleteUser when deleteChat is unavailable", async () => {
    const deleteUser = vi.fn().mockResolvedValue(undefined)
    const manager = {deleteUser}

    await deletePrivateChat(manager, "peer-pubkey")

    expect(deleteUser).toHaveBeenCalledTimes(1)
    expect(deleteUser).toHaveBeenCalledWith("peer-pubkey")
  })

  it("normalizes legacy chat ids before deletion", async () => {
    const deleteChat = vi.fn().mockResolvedValue(undefined)
    const manager = {deleteChat, deleteUser: vi.fn().mockResolvedValue(undefined)}

    await deletePrivateChat(manager, "peer-pubkey:legacy-session-id")

    expect(deleteChat).toHaveBeenCalledWith("peer-pubkey")
  })
})
