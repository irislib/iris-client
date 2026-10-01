import {
  migrateStoredPrivateContacts,
  privateContactStorageKey,
} from "./privateContactMigration"
import {create} from "zustand"
import {
  migratePrivateContactSync,
  privateContactValues,
  privateContactDocuments,
  type PrivateContactDocument,
  type PrivateContactPatch,
  type PrivateContactSyncState,
} from "nostr-social-graph/privateContactSyncV2"
import {
  createPrivateContactSyncController,
  type PrivateContactSyncController,
  type PrivateContactSyncStatus,
} from "nostr-social-graph/privateContactSyncV2Controller"
import {useUserStore} from "@/stores/user"
import {useContactMemoryStore} from "@/stores/contactMemory"

export const usePrivateContactSyncStatus = create<{status: PrivateContactSyncStatus}>(
  () => ({status: "local-only"})
)
const keyFor = privateContactStorageKey
let owner = "",
  generation = 0
let current: PrivateContactSyncController | undefined
let stopAccount: (() => void) | undefined

export function getPrivateContactDocuments(): PrivateContactDocument[] {
  return current ? privateContactDocuments(current.getState()) : []
}
export async function mergePrivateContacts(
  account: string,
  documents: PrivateContactDocument[]
) {
  if (account !== owner || useUserStore.getState().publicKey !== account || !current)
    throw new Error("Private details account is not ready")
  const active = current
  for (const document of documents) {
    if (active !== current || account !== owner) throw new Error("Account changed")
    await active.mergeTrusted(document)
  }
}
export async function queuePrivateContacts(account: string) {
  if (account !== owner || useUserStore.getState().publicKey !== account || !current)
    throw new Error("Private details account is not ready")
  await current.queueSnapshot()
}
export async function editPrivateContact(contact: string, patch: PrivateContactPatch) {
  if (!owner || useUserStore.getState().publicKey !== owner || !current)
    throw new Error("Private details are not ready. Try again.")
  await current.edit(contact, patch)
}
function project(state: PrivateContactSyncState, contacts: string[]) {
  for (const contact of contacts)
    useContactMemoryStore
      .getState()
      .projectPrivateContact(state.owner, contact, privateContactValues(state, contact))
}
async function activate() {
  const account = useUserStore.getState()
  if (account.publicKey === owner) return
  const token = ++generation
  current?.stop()
  current = undefined
  owner = account.publicKey
  usePrivateContactSyncStatus.setState({status: "local-only"})
  if (!owner) return
  if (!navigator.locks) {
    usePrivateContactSyncStatus.setState({status: "error"})
    return
  }
  const accountOwner = owner
  const load = () => {
    const saved = localStorage.getItem(keyFor(accountOwner))
    return saved ? migratePrivateContactSync(JSON.parse(saved), accountOwner) : null
  }
  let state: PrivateContactSyncState
  try {
    state = await migrateStoredPrivateContacts(accountOwner)
  } catch {
    if (token === generation) usePrivateContactSyncStatus.setState({status: "error"})
    return
  }
  if (token !== generation) return
  const controller = createPrivateContactSyncController({
    state,
    withLock: async (run) => {
      await navigator.locks.request(keyFor(accountOwner), run)
    },
    load,
    save: (next) => localStorage.setItem(keyFor(accountOwner), JSON.stringify(next)),
    send: async (document) => {
      if (token !== generation) return false
      const {sendPrivateContactDocument} = await import("./privateContactControl")
      return (
        token === generation && (await sendPrivateContactDocument(accountOwner, document))
      )
    },
    onChange: (next, change) => {
      if (token !== generation || change.source === "ack") return
      project(next, change.contact ? [change.contact] : Object.keys(next.contacts))
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
    if (memory.favorite) await controller.seed(contact, {favorite: true})
  if (token === generation) controller.retry()
}
export function resumePrivateContactSync() {
  current?.retry()
}
export function startPrivateContactSync() {
  if (stopAccount) return
  const changed = () => {
    const activation = activate(),
      token = generation
    void activation.catch(() => {
      if (token === generation) usePrivateContactSyncStatus.setState({status: "error"})
    })
  }
  stopAccount = useUserStore.subscribe(changed)
  changed()
  void import("./privateContactControl").then(({startPrivateContactBridge}) =>
    startPrivateContactBridge()
  )
  const retry = () => current?.retry()
  window.addEventListener("online", retry)
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) retry()
  })
  window.addEventListener("storage", (event) => {
    if (event.key === keyFor(owner))
      void current
        ?.refresh()
        .catch(() => usePrivateContactSyncStatus.setState({status: "error"}))
  })
}
