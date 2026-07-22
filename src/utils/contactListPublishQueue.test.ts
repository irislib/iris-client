import {describe, expect, it} from "vitest"
import {enqueueContactListPublish} from "./contactListPublishQueue"

describe("contact list publication queue", () => {
  it("serializes updates for one account so each sees the prior result", async () => {
    let releaseFirst!: () => void
    const firstBlocked = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    const follows = new Set<string>()
    const snapshots: string[][] = []

    const first = enqueueContactListPublish("owner", async () => {
      snapshots.push([...follows])
      await firstBlocked
      follows.add("alice")
    })
    const second = enqueueContactListPublish("owner", async () => {
      snapshots.push([...follows])
      follows.add("bob")
    })

    await Promise.resolve()
    expect(snapshots).toEqual([[]])
    releaseFirst()
    await Promise.all([first, second])

    expect(snapshots).toEqual([[], ["alice"]])
    expect([...follows]).toEqual(["alice", "bob"])
  })

  it("continues after a failed publication", async () => {
    await expect(
      enqueueContactListPublish("retry-owner", async () => {
        throw new Error("relay unavailable")
      })
    ).rejects.toThrow("relay unavailable")

    await expect(
      enqueueContactListPublish("retry-owner", async () => undefined)
    ).resolves.toBeUndefined()
  })
})
