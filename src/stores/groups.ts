import {createJSONStorage, persist} from "zustand/middleware"
import localforage from "localforage"
import {create} from "zustand"
import type {GroupData} from "nostr-double-ratchet"

export type Group = GroupData & {
  /**
   * Disappearing messages timer for the group, in seconds.
   * `null` means explicitly "off".
   */
  messageTtlSeconds?: number | null
}

interface GroupsStore {
  groups: Record<string, Group>
  addGroup: (group: Group) => void
  removeGroup: (groupId: string) => void
  updateGroup: (groupId: string, data: Partial<Group>) => void
  addMember: (groupId: string, memberPubKey: string) => void
}

const STORAGE_VERSION = 3

const store = create<GroupsStore>()(
  persist(
    (set) => ({
      groups: {},
      addGroup: (group) =>
        set((state) => ({
          groups: {
            ...state.groups,
            [group.id]: group,
          },
        })),
      removeGroup: (groupId) =>
        set((state) => {
          const rest = {...state.groups}
          delete rest[groupId]
          return {groups: rest}
        }),
      updateGroup: (groupId, data) =>
        set((state) => ({
          groups: {
            ...state.groups,
            [groupId]: {
              ...state.groups[groupId],
              ...data,
            },
          },
        })),
      addMember: (groupId, memberPubKey) =>
        set((state) => {
          const group = state.groups[groupId]
          if (!group) return state

          // Only add if not already a member
          if (group.members.includes(memberPubKey)) return state

          return {
            groups: {
              ...state.groups,
              [groupId]: {
                ...group,
                members: [...group.members, memberPubKey],
              },
            },
          }
        }),
    }),
    {
      name: "groups",
      storage: createJSONStorage(() => localforage),
      version: STORAGE_VERSION,
      migrate: (persisted: unknown, version) => {
        if (!persisted || typeof persisted !== "object") {
          return {groups: {}}
        }

        const raw = persisted as {groups?: unknown}
        const groups =
          raw.groups && typeof raw.groups === "object"
            ? (raw.groups as Record<string, unknown>)
            : {}

        // v1 stored a simplified group shape without admins/secret/accepted.
        if (version < 2) {
          const migrated: Record<string, Group> = {}
          for (const [id, g] of Object.entries(groups)) {
            if (!g || typeof g !== "object") continue
            const obj = g as Record<string, unknown>

            const membersRaw = obj.members
            const members = Array.isArray(membersRaw)
              ? membersRaw.filter((m): m is string => typeof m === "string")
              : []

            const adminsRaw = obj.admins
            const parsedAdmins =
              Array.isArray(adminsRaw) && adminsRaw.length > 0
                ? adminsRaw.filter((a): a is string => typeof a === "string")
                : []
            const admins =
              parsedAdmins.length > 0 ? parsedAdmins : members[0] ? [members[0]] : []

            migrated[id] = {
              id:
                typeof obj.id === "string"
                  ? obj.id
                  : typeof obj.id === "number"
                    ? String(obj.id)
                    : id,
              name: typeof obj.name === "string" ? obj.name : "",
              description: typeof obj.description === "string" ? obj.description : "",
              picture: typeof obj.picture === "string" ? obj.picture : "",
              members,
              admins,
              createdAt: typeof obj.createdAt === "number" ? obj.createdAt : Date.now(),
              secret: typeof obj.secret === "string" ? obj.secret : undefined,
              accepted: typeof obj.accepted === "boolean" ? obj.accepted : true,
              messageTtlSeconds:
                typeof obj.messageTtlSeconds === "number" ? obj.messageTtlSeconds : null,
            }
          }
          return {groups: migrated}
        }

        if (version < STORAGE_VERSION) {
          // v2 -> v3: add messageTtlSeconds.
          const migrated: Record<string, Group> = {}
          for (const [id, g] of Object.entries(groups)) {
            if (!g || typeof g !== "object") continue
            const obj = g as Record<string, unknown>
            migrated[id] = {
              ...(g as Group),
              messageTtlSeconds:
                typeof obj.messageTtlSeconds === "number" ? obj.messageTtlSeconds : null,
            }
          }
          return {groups: migrated}
        }

        return {groups: groups as Record<string, Group>}
      },
    }
  )
)

export const useGroupsStore = store
