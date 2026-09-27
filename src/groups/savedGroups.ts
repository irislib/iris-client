import {create} from "zustand"
import {persist} from "zustand/middleware"
import {groupAddress, type GroupRef} from "./model"

export const useSavedGroups = create(
  persist<{
    accounts: Record<string, GroupRef[]>
    remember: (pubkey: string, group: GroupRef) => void
  }>(
    (set) => ({
      accounts: {},
      remember: (pubkey, group) =>
        set((state) => ({
          accounts: {
            ...state.accounts,
            [pubkey]: [
              group,
              ...(state.accounts[pubkey] ?? []).filter(
                (item) => groupAddress(item) !== groupAddress(group)
              ),
            ].slice(0, 100),
          },
        })),
    }),
    {name: "iris-groups"}
  )
)
