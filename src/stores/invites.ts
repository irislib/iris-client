// import {irisStorage} from "@/utils/irisdbZustandStorage"
import {Invite, serializeSessionState, Session} from "nostr-double-ratchet/src"
import {getSessions, handleNewSessionEvent} from "@/utils/chat/Sessions"
import {subscribeToDMNotifications} from "@/utils/notifications"
import {persist, PersistStorage} from "zustand/middleware"
import {Filter, VerifiedEvent} from "nostr-tools"
import {hexToBytes} from "@noble/hashes/utils"
import {useUserStore} from "./user"
import {localState} from "irisdb"
import {ndk} from "@/utils/ndk"
import {create} from "zustand"

const subscribe = (filter: Filter, onEvent: (event: VerifiedEvent) => void) => {
  const sub = ndk().subscribe(filter)
  sub.on("event", (event) => {
    onEvent(event as unknown as VerifiedEvent)
  })
  return () => sub.stop()
}

interface InvitesState {
  privateInvites: Record<string, Invite>
  publicInvite: Invite | null
}

interface InvitesActions {
  createPublicInvite: () => void
  createInvite: (label: string) => void
  deleteInvite: (id: string) => void
}

type InvitesStore = InvitesState & InvitesActions

const storage: PersistStorage<InvitesState> = {
  getItem: (name) => {
    const value = localStorage.getItem(name)
    if (!value) return null
    const parsed = JSON.parse(value)
    const privateInvites: Record<string, Invite> = Object.fromEntries(
      parsed.privateInvites.map(([id, invite]: [string, string]) => [
        id,
        Invite.deserialize(invite),
      ])
    )
    const publicInvite: Invite | null = parsed.publicInvite
      ? Invite.deserialize(parsed.publicInvite)
      : null
    return {
      state: {
        privateInvites,
        publicInvite,
      },
    }
  },
  setItem: (name, value) => {
    const serializedPrivateInvites = Object.entries(value.state.privateInvites).map(
      ([id, invite]) => [id, invite.serialize()]
    )
    const serializedPublicInvite = value.state.publicInvite?.serialize()
    localStorage.setItem(
      name,
      JSON.stringify({
        privateInvites: serializedPrivateInvites,
        publicInvite: serializedPublicInvite,
      })
    )
  },
  removeItem: (name) => {
    localStorage.removeItem(name)
  },
}

const decryptFromWindow = (cipherText: string, pubkey: string) => {
  if (window.nostr?.nip44) {
    return window.nostr.nip44.decrypt(pubkey, cipherText)
  }
  return Promise.reject(new Error("NIP-44 not available"))
}

const listenToSession = async (session: Session, identity?: string) => {
  const sessionId = `${identity}:${session.name}`

  const existing = await localState.get("sessions").get(sessionId).once(undefined, true)
  if (existing) {
    return
  }

  localState
    .get("sessions")
    .get(sessionId)
    .get("state")
    .put(serializeSessionState(session.state))

  // session.onEvent(async (event) => {
  //   await handleNewSessionEvent(sessionId, session, event)
  //   localState
  //     .get("sessions")
  //     .get(sessionId)
  //     .get("events")
  //     .put(serializeSessionState(session.state))
  // })

  subscribeToDMNotifications()
}

const getKeyOrDecrpt = () => {
  const myPrivKey = useUserStore.getState().privateKey
  return myPrivKey ? hexToBytes(myPrivKey) : decryptFromWindow
}

export const useInvitesStore = create<InvitesStore>()(
  persist(
    (set) => ({
      privateInvites: {},
      publicInvite: null,
      createPublicInvite: () => {
        const myPubKey = useUserStore.getState().publicKey
        if (!myPubKey) return
        const invite = Invite.createNew(myPubKey, "Public Invite")
        set(() => ({publicInvite: invite}))
      },
      createInvite: (label: string) => {
        const myPubKey = useUserStore.getState().publicKey
        if (!myPubKey) return
        const id = crypto.randomUUID()
        const invite = Invite.createNew(myPubKey, label)
        const keyOrDecrpt = getKeyOrDecrpt()

        if (!keyOrDecrpt) throw new Error("No key or decrypt function")

        invite.listen(keyOrDecrpt, subscribe, listenToSession)

        set((state) => ({
          privateInvites: {...state.privateInvites, [id]: invite},
        }))
      },
      deleteInvite: (id: string) => {
        set((state) => ({
          privateInvites: Object.fromEntries(
            Object.entries(state.privateInvites).filter(([key]) => key !== id)
          ),
        }))
      },
    }),
    {
      name: "invites",
      onRehydrateStorage: () => {
        return (state) => {
          if (!state) return

          const keyOrDecrpt = getKeyOrDecrpt()

          if (!keyOrDecrpt) return

          Object.values(state.privateInvites).forEach((invite) => {
            invite.listen(keyOrDecrpt, subscribe, listenToSession)
          })
          state.publicInvite?.listen(keyOrDecrpt, subscribe, listenToSession)
        }
      },
      storage,
    }
  )
)
