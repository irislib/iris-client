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

        const raw = persisted as {groups?: Record<string, any>}
        const groups = raw.groups && typeof raw.groups === "object" ? raw.groups : {}

        // v1 stored a simplified group shape without admins/secret/accepted.
        if (version < 2) {
          const migrated: Record<string, Group> = {}
          for (const [id, g] of Object.entries(groups)) {
            if (!g || typeof g !== "object") continue
            const members = Array.isArray(g.members) ? (g.members as string[]) : []
            const admins =
              Array.isArray((g as any).admins) && (g as any).admins.length > 0
                ? ((g as any).admins as string[])
                : members.length > 0
                  ? [members[0]]
                  : []

            migrated[id] = {
              id: String((g as any).id ?? id),
              name: String((g as any).name ?? ""),
              description: (g as any).description ?? "",
              picture: (g as any).picture ?? "",
              members,
              admins,
              createdAt:
                typeof (g as any).createdAt === "number" ? (g as any).createdAt : Date.now(),
              secret: typeof (g as any).secret === "string" ? (g as any).secret : undefined,
              accepted:
                typeof (g as any).accepted === "boolean" ? (g as any).accepted : true,
              messageTtlSeconds:
                typeof (g as any).messageTtlSeconds === "number"
                  ? (g as any).messageTtlSeconds
                  : null,
            }
          }
          return {groups: migrated}
        }

        if (version < STORAGE_VERSION) {
          // v2 -> v3: add messageTtlSeconds.
          const migrated: Record<string, Group> = {}
          for (const [id, g] of Object.entries(groups)) {
            if (!g || typeof g !== "object") continue
            migrated[id] = {
              ...(g as Group),
              messageTtlSeconds:
                typeof (g as any).messageTtlSeconds === "number"
                  ? (g as any).messageTtlSeconds
                  : (g as any).messageTtlSeconds === null
                    ? null
                    : null,
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
