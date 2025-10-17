import {describe, it, expect} from "vitest"
import {createMockSessionManager} from "./helpers/mockSessionManager"
import {MockRelay} from "./helpers/mockRelay"
import {runScenario} from "./helpers/scenario"

type DeviceRecordSnapshot = {inactiveSessions: unknown[]}

const extractDeviceRecords = (manager: unknown): DeviceRecordSnapshot[] => {
  const internal = manager as {
    userRecords?: Map<string, {devices: Map<string, DeviceRecordSnapshot>}>
  }
  if (!internal.userRecords) return []
  return Array.from(internal.userRecords.values()).flatMap((record) =>
    Array.from(record.devices.values())
  )
}

describe("SessionManager", () => {
  it("should receive a message", async () => {
    const sharedRelay = new MockRelay()

    const {manager: managerAlice, publish: publishAlice} = await createMockSessionManager(
      "alice-device-1",
      sharedRelay
    )

    const {manager: managerBob, publicKey: bobPubkey} = await createMockSessionManager(
      "bob-device-1",
      sharedRelay
    )

    const chatMessage = "Hello Bob from Alice!"

    await managerAlice.sendMessage(bobPubkey, chatMessage)

    expect(publishAlice).toHaveBeenCalled()
    const bobReceivedMessage = await new Promise((resolve) => {
      managerBob.onEvent((event) => {
        if (event.content === chatMessage) resolve(true)
      })
    })
    expect(bobReceivedMessage).toBe(true)
  })

  it("should sync messages across multiple devices", async () => {
    const sharedRelay = new MockRelay(true)

    const {manager: aliceDevice1, secretKey: aliceSecretKey} =
      await createMockSessionManager("alice-device-1", sharedRelay)

    const {manager: aliceDevice2} = await createMockSessionManager(
      "alice-device-2",
      sharedRelay,
      aliceSecretKey
    )

    const {manager: bobDevice1, publicKey: bobPubkey} = await createMockSessionManager(
      "bob-device-1",
      sharedRelay
    )

    const msg1 = "Hello Bob from Alice device 1"
    const msg2 = "Hello Bob from Alice device 2"

    await aliceDevice1.sendMessage(bobPubkey, msg1)
    await aliceDevice2.sendMessage(bobPubkey, msg2)

    const bobReceivedMessages = await new Promise((resolve) => {
      const received: string[] = []
      bobDevice1.onEvent((event) => {
        if (event.content === msg1 || event.content === msg2) {
          received.push(event.content)
          if (received.length === 2) resolve(received)
        }
      })
    })

    expect(bobReceivedMessages)
  })
  it("should handle back to back messages after initial, answer, and then", async () => {
    await runScenario({
      steps: [
        {type: "send", from: "alice", to: "bob", message: "alice to bob 1"},
        {type: "send", from: "bob", to: "alice", message: "bob to alice 1"},
        {type: "send", from: "alice", to: "bob", message: "alice to bob 2"},
        {type: "send", from: "alice", to: "bob", message: "alice to bob 3"},
      ],
    })
  })
  it("should handle back to back messages after initial", async () => {
    await runScenario({
      steps: [
        {type: "send", from: "alice", to: "bob", message: "Initial message"},
        {type: "send", from: "bob", to: "alice", message: "Reply message"},
        {type: "send", from: "bob", to: "alice", message: "Reply message 2"},
      ],
    })
  })

  it("should persist sessions across manager restarts", async () => {
    await runScenario({
      steps: [
        {type: "send", from: "alice", to: "bob", message: "Initial message"},
        {type: "send", from: "bob", to: "alice", message: "Reply message"},
        {type: "send", from: "bob", to: "alice", message: "Reply message 2"},
        {type: "restart", actor: "alice"},
        {type: "restart", actor: "bob"},
        {type: "send", from: "alice", to: "bob", message: "Message after restart"},
        {type: "expect", actor: "bob", message: "Message after restart"},
      ],
    })
  })

  it("should resume communication after restart with stored sessions", async () => {
    await runScenario({
      steps: [
        {type: "send", from: "alice", to: "bob", message: "hello from alice"},
        {
          type: "send",
          from: "bob",
          to: "alice",
          message: "hey alice 1",
        },
        {
          type: "send",
          from: "bob",
          to: "alice",
          message: "hey alice 2",
        },
        {
          type: "send",
          from: "bob",
          to: "alice",
          message: "hey alice 3",
        },
        {type: "close", actor: "bob"},
        {type: "restart", actor: "bob"},
        {
          type: "send",
          from: "bob",
          to: "alice",
          message: "hey alice after restart",
        },
        {type: "expect", actor: "alice", message: "hey alice after restart"},
      ],
    })
  })

  it("should deliver alice's message after bob restarts", async () => {
    await runScenario({
      steps: [
        {type: "send", from: "alice", to: "bob", message: "alice to bob 1"},
        {type: "send", from: "bob", to: "alice", message: "bob to alice 1"},
        {type: "send", from: "alice", to: "bob", message: "alice to bob 2"},
        {type: "send", from: "alice", to: "bob", message: "alice to bob 3"},
        {type: "restart", actor: "bob"},
        {
          type: "send",
          from: "bob",
          to: "alice",
          message: "bob after restart",
        },
        {type: "expect", actor: "alice", message: "bob after restart"},
      ],
    })
  })

  it("should not accumulate additional sessions after restart", async () => {
    const sharedRelay = new MockRelay(true)

    const {
      manager: aliceManager,
      secretKey: aliceSecretKey,
      publicKey: alicePubkey,
      mockStorage: aliceStorage,
    } = await createMockSessionManager("alice-device-1", sharedRelay)

    const {
      manager: bobManager,
      secretKey: bobSecretKey,
      publicKey: bobPubkey,
      mockStorage: bobStorage,
    } = await createMockSessionManager("bob-device-1", sharedRelay)

    console.log("Initialized devices")

    const [msg1, msg2] = ["hello bob", "hello alice"]

    const messagesReceivedBob = new Promise<void>((resolve) => {
      bobManager.onEvent((event) => {
        if (event.content === msg1) {
          resolve()
        }
      })
    })

    const messagesReceivedAlice = new Promise<void>((resolve) => {
      aliceManager.onEvent((event) => {
        if (event.content === msg2) {
          resolve()
        }
      })
    })

    await aliceManager.sendMessage(bobPubkey, msg1)
    await bobManager.sendMessage(alicePubkey, msg2)

    await Promise.all([messagesReceivedBob, messagesReceivedAlice])

    aliceManager.close()
    bobManager.close()

    console.log("\n\n\nClosed managers")

    const {manager: aliceManagerRestart} = await createMockSessionManager(
      "alice-device-1",
      sharedRelay,
      aliceSecretKey,
      aliceStorage
    )

    const {manager: bobManagerRestart} = await createMockSessionManager(
      "bob-device-1",
      sharedRelay,
      bobSecretKey,
      bobStorage
    )

    console.log("Restarted managers")

    const afterRestartMessage = "after restart"

    const bobReveivedMessages = new Promise<void>((resolve) => {
      bobManagerRestart.onEvent((event) => {
        if (event.content === afterRestartMessage) {
          resolve()
        }
      })
    })

    await aliceManagerRestart.sendMessage(bobPubkey, "after restart")
    await bobReveivedMessages

    const aliceDeviceRecords = extractDeviceRecords(aliceManagerRestart)
    const bobDeviceRecords = extractDeviceRecords(bobManagerRestart)

    console.log("a", aliceDeviceRecords)
    console.log("b", bobDeviceRecords)
    ;[...aliceDeviceRecords, ...bobDeviceRecords].forEach((record) => {
      expect(record.inactiveSessions.length).toBeLessThanOrEqual(1)
    })
  })

  it("should deliver when receiver restarts multiple times", async () => {
    await runScenario({
      steps: [
        {type: "send", from: "alice", to: "bob", message: "1"},
        {type: "send", from: "bob", to: "alice", message: "2"},
        {type: "send", from: "alice", to: "bob", message: "3"},
        {type: "restart", actor: "alice"},
        {type: "send", from: "bob", to: "alice", message: "4"},
        {type: "restart", actor: "alice"},
        {type: "send", from: "bob", to: "alice", message: "5"},
      ],
    })
  })

  it("should deliver when receiver restarts multiple times (clearEvents)", async () => {
    await runScenario({
      steps: [
        {type: "send", from: "alice", to: "bob", message: "1"},
        {type: "send", from: "bob", to: "alice", message: "2"},
        {type: "send", from: "alice", to: "bob", message: "3"},
        {type: "restart", actor: "alice"},
        {type: "send", from: "bob", to: "alice", message: "4"},
        {type: "clearEvents"},
        {type: "restart", actor: "alice"},
        {type: "send", from: "bob", to: "alice", message: "5"},
      ],
    })
  })
})
