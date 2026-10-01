import {create} from "zustand"
import {getEventHash, type Filter} from "nostr-tools"
import {
  createPrivateContactSync,
  restorePrivateContactSync,
  privateContactValues,
  privateContactSyncFilter,
  privateContactDocuments,
  type PrivateContactDocument,
  type PrivateContactPatch,
  type PrivateContactSyncState,
} from "nostr-social-graph/privateContactSync"
import {
  createPrivateContactSyncController,
  type PrivateContactSyncController,
  type PrivateContactSyncStatus,
} from "nostr-social-graph/privateContactSyncController"
import {AppEvent, type Signer} from "@/lib/nostr"
import {nostr} from "./nostrClient"
import {useUserStore} from "@/stores/user"
import {useContactMemoryStore} from "@/stores/contactMemory"

export const usePrivateContactSyncStatus = create<{
  status: PrivateContactSyncStatus
  needsSigner: boolean
}>(() => ({status: "local-only", needsSigner: false}))
const keyFor = (owner: string) => `nostr-social-memory:v1:${owner}`
let owner = "",
  generation = 0,
  paused = false
let current: PrivateContactSyncController | undefined
let activeSigner: Signer | undefined
let stopEvents: (() => void) | undefined
let stopAccount: (() => void) | undefined
let historyRun: Promise<void> | undefined
let historyRetry: ReturnType<typeof setTimeout> | undefined
const randomId = () => crypto.randomUUID().replaceAll("-", "")

export function getPrivateContactDocuments(): PrivateContactDocument[] {
  return current ? privateContactDocuments(current.getState()) : []
}
export async function mergePrivateContacts(
  account: string,
  documents: PrivateContactDocument[]
) {
  if (account !== owner || useUserStore.getState().publicKey !== account || !current)
    return
  const active = current
  for (const document of documents) {
    if (active !== current || account !== owner) return
    await active.mergeTrusted(document)
  }
}
export async function editPrivateContact(contact: string, patch: PrivateContactPatch) {
  if (!owner || useUserStore.getState().publicKey !== owner || !current)
    throw new Error("Private details are not ready. Try again.")
  await current.edit(contact, patch)
}
function queryRelay(filter: Filter, relay: string) {
  return nostr()
    .getRuntime()
    .query([filter], {
      cache: "network-only",
      includeSuperseded: true,
      relays: [relay],
    })
}
function readHistory(
  token: number,
  controller: PrivateContactSyncController
): Promise<void> {
  if (historyRun) return historyRun
  const run = (async () => {
    controller.beginRead()
    try {
      const relays = [...nostr().pool.relays.keys()]
      if (!relays.length) throw new Error("No message servers")
      let allComplete = true
      for (const relay of relays) {
        try {
          let until: number | undefined,
            limit = 256,
            complete = false
          for (let page = 0; page < 100 && token === generation; page++) {
            const result = await queryRelay(
              {
                ...privateContactSyncFilter(owner),
                limit,
                ...(until === undefined ? {} : {until}),
              },
              relay
            )
            if (token !== generation) return
            for (const event of result.events) await controller.receive(event)
            if (!result.complete)
              throw new Error("Private sync is waiting for message servers")
            if (result.events.length < limit) {
              complete = true
              break
            }
            const oldest = Math.min(...result.events.map((event) => event.created_at))
            if (oldest === until) {
              if (limit >= 8192) throw new Error("Private sync could not finish loading")
              limit *= 2
            } else {
              until = oldest
              limit = 256
            }
          }
          if (!complete) throw new Error("Private sync could not finish loading")
        } catch {
          allComplete = false
        }
      }
      if (!allComplete) throw new Error("Private sync is waiting for message servers")
      await controller.markReady()
    } catch {
      if (token !== generation) return
      await controller.markReady(false)
      clearTimeout(historyRetry)
      historyRetry = setTimeout(() => {
        if (token === generation) void readHistory(token, controller)
      }, 30_000)
    }
  })()
  historyRun = run
  void run.finally(() => {
    if (historyRun === run) historyRun = undefined
  })
  return run
}
function project(state: PrivateContactSyncState, contacts: string[]) {
  for (const contact of contacts)
    useContactMemoryStore
      .getState()
      .projectPrivateContact(state.owner, contact, privateContactValues(state, contact))
}
function activate() {
  const account = useUserStore.getState(),
    signer = nostr().signer
  if (account.publicKey === owner && signer === activeSigner) return
  const token = ++generation
  current?.stop()
  current = undefined
  stopEvents?.()
  stopEvents = undefined
  clearTimeout(historyRetry)
  historyRun = undefined
  owner = account.publicKey
  activeSigner = signer
  paused = false
  usePrivateContactSyncStatus.setState({status: "local-only", needsSigner: false})
  if (!owner) return
  if (!navigator.locks) {
    usePrivateContactSyncStatus.setState({status: "error"})
    return
  }
  let state: PrivateContactSyncState
  try {
    const saved = localStorage.getItem(keyFor(owner))
    state = saved
      ? restorePrivateContactSync(JSON.parse(saved), owner)
      : createPrivateContactSync(owner, randomId())
  } catch {
    usePrivateContactSyncStatus.setState({status: "error"})
    return
  }
  const accountOwner = owner
  const withSigner = async <T>(run: () => Promise<T>): Promise<T> => {
    if (paused) throw new Error("Private sync is waiting for your signer")
    try {
      return await run()
    } catch (error) {
      if (account.nip07Login && token === generation) {
        paused = true
        usePrivateContactSyncStatus.setState({needsSigner: true})
      }
      throw error
    }
  }
  const controller = createPrivateContactSyncController({
    state,
    withLock: async (run) => {
      await navigator.locks.request(keyFor(accountOwner), run)
    },
    load: () => {
      const saved = localStorage.getItem(keyFor(accountOwner))
      return saved ? restorePrivateContactSync(JSON.parse(saved), accountOwner) : null
    },
    save: (next) => localStorage.setItem(keyFor(accountOwner), JSON.stringify(next)),
    ...(signer
      ? {
          signer: {
            getPublicKey: async () => {
              if (useUserStore.getState().publicKey !== accountOwner)
                throw new Error("Account changed")
              return (await withSigner(() => signer.user())).pubkey
            },
            signEvent: async (draft) => {
              const unsigned = {...draft, pubkey: accountOwner}
              const event = {...unsigned, id: getEventHash(unsigned), sig: ""}
              event.sig = await withSigner(() => signer.sign(event))
              return event
            },
            nip44Encrypt: (recipient, content) =>
              withSigner(() =>
                signer.encrypt(nostr().getUser({pubkey: recipient}), content, "nip44")
              ),
            nip44Decrypt: (sender, content) =>
              withSigner(() =>
                signer.decrypt(nostr().getUser({pubkey: sender}), content, "nip44")
              ),
          },
          publish: async (event) => {
            if (token !== generation) return false
            const accepted = await nostr().publishEvent(
              new AppEvent(nostr(), event),
              undefined,
              {requireAck: true}
            )
            return token === generation && accepted.size > 0
          },
        }
      : {}),
    onChange: (next, change) => {
      if (token !== generation || change.source === "prepared" || change.source === "ack")
        return
      project(next, change.contact ? [change.contact] : Object.keys(next.contacts))
      if (change.source === "local" || change.source === "remote") {
        void import("./privateContactControl")
          .then(({sendPrivateContactDocument}) => {
            if (token !== generation) return
            const document = privateContactDocuments(controller.getState()).find(
              (item) => item.contact === change.contact
            )
            if (document) return sendPrivateContactDocument(accountOwner, document)
          })
          .catch(() => {})
      }
    },
    onStatus: (status) => {
      if (token === generation) usePrivateContactSyncStatus.setState({status})
    },
  })
  current = controller
  usePrivateContactSyncStatus.setState({status: controller.getStatus()})
  const legacy = {...useContactMemoryStore.getState().accounts[owner]}
  project(state, Object.keys(state.contacts))
  for (const [contact, memory] of Object.entries(legacy))
    if (memory.favorite) void controller.seed(contact, {favorite: true}).catch(() => {})
  if (signer) {
    const sub = nostr().subscribe(privateContactSyncFilter(owner))
    sub.on("event", (event: AppEvent) => {
      void controller.receive(event.rawEvent()).catch(() => {})
    })
    stopEvents = () => sub.stop()
    void readHistory(token, controller)
  }
}
export function resumePrivateContactSync() {
  paused = false
  usePrivateContactSyncStatus.setState({needsSigner: false})
  current?.retry()
  if (current && activeSigner) void readHistory(generation, current)
}
export function startPrivateContactSync() {
  if (stopAccount) return
  stopAccount = useUserStore.subscribe(activate)
  activate()
  void import("./privateContactControl").then(({startPrivateContactBridge}) =>
    startPrivateContactBridge()
  )
  const retry = () => {
    current?.retry()
    if (current && activeSigner) void readHistory(generation, current)
  }
  window.addEventListener("online", retry)
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) retry()
  })
  window.addEventListener("storage", (event) => {
    if (event.key === keyFor(owner)) void current?.refresh().catch(() => {})
  })
}
