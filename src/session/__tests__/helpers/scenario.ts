import {MockRelay} from "./mockRelay"
import {createMockSessionManager} from "./mockSessionManager"
import SessionManager from "../../SessionManager"
import {Rumor} from "nostr-double-ratchet"
import type {InMemoryStorageAdapter} from "../../StorageAdapter"

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
  deviceId: string
  manager: SessionManager
  secretKey: Uint8Array
  publicKey: string
  storage: InMemoryStorageAdapter
  events: Rumor[]
  messageCounts: Map<string, number>
  waiters: MessageWaiter[]
  unsub?: () => void
}

type ScenarioStep =
  | {type: "send"; from: ActorId; to: ActorId; message: string}
  | {type: "expect"; actor: ActorId; message: string}
  | {type: "expectAll"; actor: ActorId; messages: string[]}
  | {type: "close"; actor: ActorId}
  | {type: "restart"; actor: ActorId}
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
      alice: await bootstrapActor("alice-device-1", relay),
      bob: await bootstrapActor("bob-device-1", relay),
    },
  }

  for (const step of def.steps) {
    console.log(`\n--- Executing step: ${JSON.stringify(step)} ---`)
    switch (step.type) {
      case "send":
        await sendMessage(context, step.from, step.to, step.message)
        break
      case "expect":
        await expectMessage(context, step.actor, step.message)
        break
      case "expectAll":
        await expectAllMessages(context, step.actor, step.messages)
        break
      case "close":
        closeActor(context, step.actor)
        break
      case "restart":
        await restartActor(context, step.actor)
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

async function bootstrapActor(
  deviceId: string,
  relay: MockRelay,
  existingSecretKey?: Uint8Array,
  existingStorage?: InMemoryStorageAdapter
): Promise<ActorState> {
  const {manager, secretKey, publicKey, mockStorage} = await createMockSessionManager(
    deviceId,
    relay,
    existingSecretKey,
    existingStorage
  )

  const events: Rumor[] = []
  const state: ActorState = {
    deviceId,
    manager,
    secretKey,
    publicKey,
    storage: mockStorage,
    events,
    messageCounts: new Map(),
    waiters: [],
  }

  state.unsub = attachManagerListener(state)

  return state
}

async function sendMessage(
  context: ScenarioContext,
  from: ActorId,
  to: ActorId,
  message: string
) {
  const sender = context.actors[from]
  const recipient = context.actors[to]
  const wait = waitForMessage(recipient, to, message, {existingOk: false})
  await sender.manager.sendMessage(recipient.publicKey, message)
  await wait
}

async function expectMessage(context: ScenarioContext, actor: ActorId, message: string) {
  const state = context.actors[actor]
  await waitForMessage(state, actor, message, {existingOk: true})
}

async function expectAllMessages(
  context: ScenarioContext,
  actor: ActorId,
  messages: string[]
) {
  console.log(`\n\n\nExpecting all messages on ${actor}:`, messages)
  for (const msg of messages) {
    await waitForMessage(context.actors[actor], actor, msg, {existingOk: true})
  }
}

function closeActor(context: ScenarioContext, actor: ActorId) {
  const state = context.actors[actor]
  rejectPendingWaiters(state, new Error(`Actor ${actor} closed`))
  state.unsub?.()
  state.manager.close()
}

async function restartActor(context: ScenarioContext, actor: ActorId) {
  const state = context.actors[actor]
  const {deviceId, manager, secretKey, storage, unsub} = state
  unsub?.()
  manager.close()
  const {manager: newManager} = await createMockSessionManager(
    deviceId,
    context.relay,
    secretKey,
    storage
  )

  state.manager = newManager
  state.unsub = attachManagerListener(state)
}

function attachManagerListener(state: ActorState): () => void {
  const onEvent = (event: Rumor) => {
    state.events.push(event)
    const content = event.content ?? ""
    const currentCount = state.messageCounts.get(content) ?? 0
    const nextCount = currentCount + 1
    state.messageCounts.set(content, nextCount)
    resolveWaiters(state, content, nextCount)
  }

  const unsubscribe = state.manager.onEvent(onEvent)
  return () => {
    unsubscribe()
  }
}

function resolveWaiters(state: ActorState, content: string, count: number) {
  const pending = state.waiters.slice()
  for (const waiter of pending) {
    if (waiter.message === content && count >= waiter.targetCount) {
      waiter.resolve()
    }
  }
}

function waitForMessage(
  state: ActorState,
  actor: ActorId,
  message: string,
  options: {existingOk: boolean}
): Promise<void> {
  const {existingOk} = options
  const currentCount = state.messageCounts.get(message) ?? 0
  if (existingOk && currentCount > 0) {
    return Promise.resolve()
  }

  return new Promise<void>((resolve, reject) => {
    const handleResolve = (waiter: MessageWaiter) => {
      clearTimeout(waiter.timeout)
      removeWaiter(state, waiter)
      resolve()
    }

    const handleReject = (waiter: MessageWaiter, error: Error) => {
      clearTimeout(waiter.timeout)
      removeWaiter(state, waiter)
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
          new Error(`Timed out waiting for message '${message}' on ${actor}`)
        )
      }, 5000),
    }

    state.waiters.push(waiter)
  })
}

function removeWaiter(state: ActorState, waiter: MessageWaiter) {
  const index = state.waiters.indexOf(waiter)
  if (index >= 0) {
    state.waiters.splice(index, 1)
  }
}

function rejectPendingWaiters(state: ActorState, error: Error) {
  const waiters = state.waiters.slice()
  for (const waiter of waiters) {
    waiter.reject(error)
  }
}
