import {bytesToHex, hexToBytes} from "@noble/hashes/utils"
import localforage from "localforage"
import {create} from "zustand"
import {createJSONStorage, persist} from "zustand/middleware"

import {
  SenderKeyState,
  type SenderKeyDistribution,
  type SenderKeyStateSerialized,
} from "nostr-double-ratchet"
import {generateSecretKey, getPublicKey} from "nostr-tools"

export interface MyGroupSenderKey {
  senderEventPubkey: string
  /** Hex-encoded 32-byte secret key for signing outer group events. */
  senderEventSecretKey: string
  keyId: number
  state: SenderKeyStateSerialized
  /** UNIX seconds */
  createdAt: number
  /** UNIX seconds; used to avoid re-sending distribution on every message. */
  distributionSentAt?: number
}

export interface RemoteGroupSenderKeys {
  groupId: string
  /** Real author pubkey (owner) that distributed this sender key (best-effort). */
  senderPubkey?: string
  /** keyId -> SenderKeyStateSerialized */
  keys: Record<string, SenderKeyStateSerialized>
}

interface GroupSenderKeysStore {
  /** groupId -> my sender key config for publishing group messages from this device */
  mySenders: Record<string, MyGroupSenderKey>
  /** senderEventPubkey -> keys for decrypting messages from that sender */
  senders: Record<string, RemoteGroupSenderKeys>

  ensureMySender: (groupId: string) => MyGroupSenderKey
  updateMySenderState: (groupId: string, next: SenderKeyStateSerialized) => void
  markMyDistributionSent: (groupId: string, atSeconds: number) => void

  upsertDistribution: (dist: SenderKeyDistribution, senderPubkey?: string) => void
  updateRemoteSenderState: (
    senderEventPubkey: string,
    keyId: number,
    next: SenderKeyStateSerialized
  ) => void

  removeGroupData: (groupId: string) => void
  clear: () => void
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000)
}

function randomU32(): number {
  const buf = new Uint32Array(1)
  crypto.getRandomValues(buf)
  return buf[0] >>> 0
}

export const useGroupSenderKeysStore = create<GroupSenderKeysStore>()(
  persist(
    (set, get) => ({
      mySenders: {},
      senders: {},

      ensureMySender: (groupId) => {
        const existing = get().mySenders[groupId]
        if (existing) return existing

        const senderEventSecretKeyBytes = generateSecretKey()
        const senderEventPubkey = getPublicKey(senderEventSecretKeyBytes)

        const keyId = randomU32()
        const chainKeyBytes = generateSecretKey()
        const senderKeyState = new SenderKeyState(keyId, chainKeyBytes, 0)

        const createdAt = nowSeconds()
        const created: MyGroupSenderKey = {
          senderEventPubkey,
          senderEventSecretKey: bytesToHex(senderEventSecretKeyBytes),
          keyId,
          state: senderKeyState.toJSON(),
          createdAt,
        }

        set((state) => ({
          mySenders: {
            ...state.mySenders,
            [groupId]: created,
          },
        }))

        return created
      },

      updateMySenderState: (groupId, next) =>
        set((state) => {
          const existing = state.mySenders[groupId]
          if (!existing) return state
          return {
            mySenders: {
              ...state.mySenders,
              [groupId]: {
                ...existing,
                state: next,
              },
            },
          }
        }),

      markMyDistributionSent: (groupId, atSeconds) =>
        set((state) => {
          const existing = state.mySenders[groupId]
          if (!existing) return state
          if (existing.distributionSentAt && existing.distributionSentAt >= atSeconds) {
            return state
          }
          return {
            mySenders: {
              ...state.mySenders,
              [groupId]: {
                ...existing,
                distributionSentAt: atSeconds,
              },
            },
          }
        }),

      upsertDistribution: (dist, senderPubkey) => {
        const senderEventPubkey = dist.senderEventPubkey
        if (!senderEventPubkey) return

        set((state) => {
          const existing = state.senders[senderEventPubkey]
          const keyIdStr = String(dist.keyId >>> 0)

          // Never overwrite an existing progressed state with a (possibly stale) distribution.
          const existingKeyState = existing?.keys?.[keyIdStr]
          const nextKeyState =
            existingKeyState ?? SenderKeyState.fromDistribution(dist).toJSON()

          return {
            senders: {
              ...state.senders,
              [senderEventPubkey]: {
                groupId: dist.groupId,
                senderPubkey: senderPubkey ?? existing?.senderPubkey,
                keys: {
                  ...(existing?.keys ?? {}),
                  [keyIdStr]: nextKeyState,
                },
              },
            },
          }
        })
      },

      updateRemoteSenderState: (senderEventPubkey, keyId, next) =>
        set((state) => {
          const existing = state.senders[senderEventPubkey]
          if (!existing) return state
          const keyIdStr = String(keyId >>> 0)
          return {
            senders: {
              ...state.senders,
              [senderEventPubkey]: {
                ...existing,
                keys: {
                  ...existing.keys,
                  [keyIdStr]: next,
                },
              },
            },
          }
        }),

      removeGroupData: (groupId) =>
        set((state) => {
          const mySenders = {...state.mySenders}
          delete mySenders[groupId]

          const senders: Record<string, RemoteGroupSenderKeys> = {}
          for (const [senderEventPubkey, record] of Object.entries(state.senders)) {
            if (record.groupId === groupId) continue
            senders[senderEventPubkey] = record
          }

          return {mySenders, senders}
        }),

      clear: () => set({mySenders: {}, senders: {}}),
    }),
    {
      name: "group-sender-keys",
      storage: createJSONStorage(() => localforage),
      version: 1,
      migrate: (persisted: unknown) => {
        // Defensive: ensure no legacy data shape can break boot.
        if (!persisted || typeof persisted !== "object") {
          return {mySenders: {}, senders: {}}
        }
        const state = persisted as Partial<GroupSenderKeysStore>
        return {
          mySenders:
            state.mySenders && typeof state.mySenders === "object" ? state.mySenders : {},
          senders:
            state.senders && typeof state.senders === "object" ? state.senders : {},
        }
      },
    }
  )
)

export function getMySenderEventSecretKeyBytes(groupId: string): Uint8Array | null {
  const record = useGroupSenderKeysStore.getState().mySenders[groupId]
  if (!record?.senderEventSecretKey) return null
  try {
    return hexToBytes(record.senderEventSecretKey)
  } catch {
    return null
  }
}
