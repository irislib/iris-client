import {beforeEach, describe, expect, it, vi} from "vitest"
import {GROUP_ROSTER_FACT_KIND} from "nostr-double-ratchet"
import {useGroupsStore, type Group} from "@/stores/groups"

const OWNER = "a".repeat(64)
const MEMBER = "b".repeat(64)
const GROUP_ID = "group-roster"

const runtime = vi.hoisted(() => ({
  ensure: vi.fn().mockResolvedValue(undefined),
  sendEvent: vi.fn().mockResolvedValue(undefined),
  upsertGroup: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@/shared/services/PrivateChats", () => ({
  ensureNdrRuntime: runtime.ensure,
  getNdrRuntime: () => runtime,
}))

import {publishGroupRosterViaTransport} from "./groupTransport"

describe("publishGroupRosterViaTransport", () => {
  beforeEach(() => {
    runtime.ensure.mockClear()
    runtime.sendEvent.mockClear()
    runtime.upsertGroup.mockClear()
    useGroupsStore.setState({groups: {}} as any)
  })

  it("fans out one canonical secret-free roster fact to the exact recipients", async () => {
    const group: Group = {
      id: GROUP_ID,
      name: "Roster Group",
      description: "canonical metadata",
      members: [OWNER, MEMBER],
      admins: [OWNER],
      createdAt: 1_700_000_000_000,
      secret: "not-on-the-wire",
      accepted: true,
    }
    useGroupsStore.setState({groups: {[GROUP_ID]: group}} as any)
    const now = vi.spyOn(Date, "now").mockReturnValue(1_700_000_100_000)

    try {
      const roster = await publishGroupRosterViaTransport({
        group,
        senderPubKey: OWNER,
      })

      expect(roster.kind).toBe(GROUP_ROSTER_FACT_KIND)
      expect(roster.content).toBe("")
      expect(roster.tags).toContainEqual(["group_id", GROUP_ID])
      expect(JSON.stringify(roster)).not.toContain(group.secret)
      expect(runtime.sendEvent).toHaveBeenCalledTimes(2)
      expect(runtime.sendEvent.mock.calls.map(([recipient]) => recipient).sort()).toEqual(
        [OWNER, MEMBER]
      )
      for (const [recipient, event, owner] of runtime.sendEvent.mock.calls) {
        expect(owner).toBe(OWNER)
        expect(event.tags).toContainEqual(["p", recipient])
      }
      expect(useGroupsStore.getState().groups[GROUP_ID].rosterRevision).toBe(
        1_700_000_100_000
      )
    } finally {
      now.mockRestore()
    }
  })
})
