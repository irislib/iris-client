import {MockRelay} from "./mockRelay"
import {createMockSessionManager} from "./mockSessionManager"
import {Rumor, InMemoryStorageAdapter, SessionManager} from "nostr-double-ratchet/src"
import {generateSecretKey, getPublicKey} from "nostr-tools"
import {createDebugLogger} from "@/utils/createDebugLogger"
import {DEBUG_NAMESPACES} from "@/utils/constants"

const {log} = createDebugLogger(DEBUG_NAMESPACES.UTILS)

export type ActorId = "alice" | "bob"

export interface ScenarioContext {
  relay: MockRelay
  actors: Record<ActorId, ActorState>
}

interface MessageWaiter {
  message: string
  targetCount: number
  resolve: () => void
  reject: (error: Error) => void
  timeout: ReturnType<typeof setTimeout>
}

interface ActorState {
  secretKey: Uint8Array
  publicKey: string
  devices: Map<string, DeviceState>
}

interface DeviceState {
  deviceId: string
  manager: SessionManager
  storage: InMemoryStorageAdapter
  events: Rumor[]
  messageCounts: Map<string, number>
  waiters: MessageWaiter[]
  unsub?: () => void
}

interface ActorDeviceRef {
  actor: ActorId
  deviceId: string
}

type WaitTarget = ActorDeviceRef | ActorDeviceRef[] | "all-recipient-devices"

type ScenarioStep =
  | {
      type: "send"
      from: ActorDeviceRef
      to: ActorId
      message: string
      waitOn?: WaitTarget
    }
  | {type: "expect"; actor: ActorId; deviceId: string; message: string}
  | {type: "expectAll"; actor: ActorId; deviceId: string; messages: string[]}
  | {type: "addDevice"; actor: ActorId; deviceId: string}
  | {type: "close"; actor: ActorId; deviceId: string}
  | {type: "restart"; actor: ActorId; deviceId: string}
  | {type: "clearEvents"}
  | {type: "noop"}

type ScenarioDefinition = {
  steps: ScenarioStep[]
}

export async function runScenario(def: ScenarioDefinition): Promise<ScenarioContext> {
  const relay = new MockRelay()
  const context: ScenarioContext = {
    relay,
    actors: {
      alice: createActorState(),
      bob: createActorState(),
    },
  }

  for (const step of def.steps) {
    log(`\n--- Executing step: ${JSON.stringify(step)} ---`)
    switch (step.type) {
      case "send":
        await sendMessage(context, step.from, step.to, step.message, step.waitOn)
        break
      case "expect":
        await expectMessage(context, step.actor, step.deviceId, step.message)
        break
      case "expectAll":
        await expectAllMessages(context, step.actor, step.deviceId, step.messages)
        break
      case "addDevice":
        await addDevice(context, step.actor, step.deviceId)
        break
      case "close":
        closeDevice(context, {actor: step.actor, deviceId: step.deviceId})
        break
      case "restart":
        await restartDevice(context, {actor: step.actor, deviceId: step.deviceId})
        break
      case "noop":
        await Promise.resolve()
        break
      case "clearEvents":
        context.relay.clearEvents()
        break
      default: {
        const exhaustive: never = step
        throw new Error(`Unhandled step ${JSON.stringify(exhaustive)}`)
      }
    }
  }

  return context
}

function createActorState(): ActorState {
  const secretKey = generateSecretKey()
  const publicKey = getPublicKey(secretKey)
  return {
    secretKey,
    publicKey,
    devices: new Map(),
  }
}

async function sendMessage(
  context: ScenarioContext,
  from: ActorDeviceRef,
  to: ActorId,
  message: string,
  waitOn?: WaitTarget
) {
  const senderDevice = getDevice(context, from)
  const recipientActor = context.actors[to]
  if (!recipientActor) {
    throw new Error(`Unknown recipient actor '${to}'`)
  }

  const waitTargets = resolveWaitTargets(context, waitOn, recipientActor)
  const waits = waitTargets.map((device) =>
    waitForMessage(device, deviceLabel(recipientActor, device), message, {
      existingOk: false,
    })
  )

  await senderDevice.manager.sendMessage(recipientActor.publicKey, message)
  await Promise.all(waits)
}

async function expectMessage(
  context: ScenarioContext,
  actor: ActorId,
  deviceId: string,
  message: string
) {
  const device = getDevice(context, {actor, deviceId})
  await waitForMessage(device, deviceLabel(context.actors[actor], device), message, {
    existingOk: true,
  })
}

async function expectAllMessages(
  context: ScenarioContext,
  actor: ActorId,
  deviceId: string,
  messages: string[]
) {
  log(`\n\n\nExpecting all messages on ${actor}:`, messages)
  const actorState = context.actors[actor]
  const device = getDevice(context, {actor, deviceId})
  for (const msg of messages) {
    await waitForMessage(device, deviceLabel(actorState, device), msg, {existingOk: true})
  }
}

function closeDevice(context: ScenarioContext, ref: ActorDeviceRef) {
  const device = getDevice(context, ref)
  rejectPendingWaiters(device, new Error(`Device ${refToString(ref)} closed`))
  device.unsub?.()
  device.manager.close()
}

async function restartDevice(context: ScenarioContext, ref: ActorDeviceRef) {
  const actor = context.actors[ref.actor]
  if (!actor) {
    throw new Error(`Unknown actor '${ref.actor}'`)
  }
  const device = getDevice(context, ref)
  device.unsub?.()
  device.manager.close()
  const {manager: newManager} = await createMockSessionManager(
    device.deviceId,
    context.relay,
    actor.secretKey,
    device.storage
  )

  device.manager = newManager
  device.unsub = attachManagerListener(actor, device)
}

function attachManagerListener(actor: ActorState, device: DeviceState): () => void {
  const onEvent = (event: Rumor) => {
    device.events.push(event)
    const content = event.content ?? ""
    const currentCount = device.messageCounts.get(content) ?? 0
    const nextCount = currentCount + 1
    device.messageCounts.set(content, nextCount)
    resolveWaiters(device, content, nextCount)
  }

  const unsubscribe = device.manager.onEvent(onEvent)
  return () => {
    unsubscribe()
  }
}

function resolveWaiters(device: DeviceState, content: string, count: number) {
  const pending = device.waiters.slice()
  for (const waiter of pending) {
    if (waiter.message === content && count >= waiter.targetCount) {
      waiter.resolve()
    }
  }
}

function waitForMessage(
  device: DeviceState,
  label: string,
  message: string,
  options: {existingOk: boolean}
): Promise<void> {
  const {existingOk} = options
  const currentCount = device.messageCounts.get(message) ?? 0
  if (existingOk && currentCount > 0) {
    return Promise.resolve()
  }

  return new Promise<void>((resolve, reject) => {
    const handleResolve = (waiter: MessageWaiter) => {
      clearTimeout(waiter.timeout)
      removeWaiter(device, waiter)
      resolve()
    }

    const handleReject = (waiter: MessageWaiter, error: Error) => {
      clearTimeout(waiter.timeout)
      removeWaiter(device, waiter)
      reject(error)
    }

    const waiter: MessageWaiter = {
      message,
      targetCount: currentCount + 1,
      resolve: () => handleResolve(waiter),
      reject: (error: Error) => handleReject(waiter, error),
      timeout: setTimeout(() => {
        handleReject(
          waiter,
          new Error(`Timed out waiting for message '${message}' on ${label}`)
        )
      }, 5000),
    }

    device.waiters.push(waiter)
  })
}

function removeWaiter(device: DeviceState, waiter: MessageWaiter) {
  const index = device.waiters.indexOf(waiter)
  if (index >= 0) {
    device.waiters.splice(index, 1)
  }
}

function rejectPendingWaiters(device: DeviceState, error: Error) {
  const waiters = device.waiters.slice()
  for (const waiter of waiters) {
    waiter.reject(error)
  }
}

function refToString(ref: ActorDeviceRef): string {
  return `${ref.actor}/${ref.deviceId}`
}

async function addDevice(context: ScenarioContext, actorId: ActorId, deviceId: string) {
  const actor = getActor(context, actorId)
  if (actor.devices.has(deviceId)) {
    throw new Error(`Device '${deviceId}' already exists for actor '${actorId}'`)
  }

  const {manager, mockStorage} = await createMockSessionManager(
    deviceId,
    context.relay,
    actor.secretKey
  )

  const deviceState = createDeviceState(actor, deviceId, manager, mockStorage)
  actor.devices.set(deviceId, deviceState)
  return deviceState
}

function getActor(context: ScenarioContext, actorId: ActorId): ActorState {
  const actor = context.actors[actorId]
  if (!actor) {
    throw new Error(`Unknown actor '${actorId}'`)
  }
  return actor
}

function getDevice(context: ScenarioContext, ref: ActorDeviceRef): DeviceState {
  const actor = getActor(context, ref.actor)
  const device = actor.devices.get(ref.deviceId)
  if (!device) {
    throw new Error(`Device '${ref.deviceId}' not registered for actor '${ref.actor}'`)
  }
  return device
}

function deviceLabel(actor: ActorState, device: DeviceState): string {
  return `${actor.publicKey.slice(0, 8)}.../${device.deviceId}`
}

function createDeviceState(
  actor: ActorState,
  deviceId: string,
  manager: SessionManager,
  storage: InMemoryStorageAdapter
): DeviceState {
  const events: Rumor[] = []
  const deviceState: DeviceState = {
    deviceId,
    manager,
    storage,
    events,
    messageCounts: new Map(),
    waiters: [],
  }

  deviceState.unsub = attachManagerListener(actor, deviceState)
  return deviceState
}

function resolveWaitTargets(
  context: ScenarioContext,
  waitOn: WaitTarget | undefined,
  recipient: ActorState
): DeviceState[] {
  if (!waitOn) {
    const devices = Array.from(recipient.devices.values())
    if (devices.length === 0) {
      throw new Error("Recipient actor has no devices. Add one before sending.")
    }
    return devices
  }

  if (waitOn === "all-recipient-devices") {
    const devices = Array.from(recipient.devices.values())
    if (devices.length === 0) {
      throw new Error("Recipient has no devices to wait on")
    }
    return devices
  }

  const refs = Array.isArray(waitOn) ? waitOn : [waitOn]
  return refs.map((ref) => getDevice(context, ref))
}
