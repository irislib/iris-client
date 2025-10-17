import {describe, it, expect} from "vitest"

import {InMemoryStorageAdapter} from "../StorageAdapter"
import {migrateToVersion1} from "../migrations/migrateToVersion1"
import {
  SESSION_MANAGER_VERSION_KEY,
  deviceInviteKey,
  inviteAcceptKey,
  userInviteKey,
  userRecordKey,
} from "../storageKeys"

describe("SessionManager migration", () => {
  it("migrates legacy storage into versioned layout", async () => {
    const storage = new InMemoryStorageAdapter()
    const userPubkey = "9".repeat(64)
    const deviceId = "alice-device-1"
    const otherInactive: [string, unknown] = [
      "inactive-session",
      {state: "inactive"},
    ]
    const legacyRecord = {
      publicKey: userPubkey,
      devices: [
        {
          deviceId,
          activeSession: ["active-session", {state: "active"}] as [string, unknown],
          inactiveSessions: [otherInactive],
        },
      ],
    }

    await storage.put(`user/${userPubkey}`, legacyRecord)
    await storage.put(`invite/${deviceId}`, "device-invite")
    await storage.put(`invite/${userPubkey}`, "user-invite")
    await storage.put(`invite-accept/${userPubkey}/${deviceId}/event-id`, "1")
    await storage.put(`session/${userPubkey}/${deviceId}/old`, {legacy: true})

    await migrateToVersion1(storage)

    expect(await storage.get(SESSION_MANAGER_VERSION_KEY)).toBe("1")
    expect(await storage.get(`user/${userPubkey}`)).toBeUndefined()

    const migratedRecord = await storage.get<{
      publicKey: string
      devices: Array<{
        deviceId: string
        activeSession: [string, unknown] | null
        inactiveSessions: [string, unknown][]
      }>
    }>(userRecordKey(userPubkey))

    expect(migratedRecord).toBeDefined()
    const migratedDevice = migratedRecord?.devices[0]
    expect(migratedDevice?.activeSession).toBeNull()
    expect(migratedDevice?.inactiveSessions.length).toBe(2)
    expect(migratedDevice?.inactiveSessions[0][0]).toBe("active-session")

    expect(await storage.get(deviceInviteKey(deviceId))).toBe("device-invite")
    expect(await storage.get(`invite/${deviceId}`)).toBeUndefined()

    expect(await storage.get(userInviteKey(userPubkey))).toBe("user-invite")
    expect(await storage.get(`invite/${userPubkey}`)).toBeUndefined()

    expect(
      await storage.get(inviteAcceptKey("event-id", userPubkey, deviceId))
    ).toBe("1")
    expect(await storage.get(`invite-accept/${userPubkey}/${deviceId}/event-id`)).toBeUndefined()

    const legacySessionKeys = await storage.list("session/")
    expect(legacySessionKeys).toHaveLength(0)
  })

  it("does not re-run migration once version is recorded", async () => {
    const storage = new InMemoryStorageAdapter()
    await storage.put(SESSION_MANAGER_VERSION_KEY, "1")
    await migrateToVersion1(storage)

    expect(await storage.list()).toEqual([SESSION_MANAGER_VERSION_KEY])
  })
})
