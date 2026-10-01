import {create} from "zustand"
import {persist} from "zustand/middleware"
import {
  type ContactMemory,
  emptyContactMemory,
  observeContactName,
  approveContactName,
  setContactFavorite,
} from "@/utils/contactMemory"

interface ContactMemoryState {
  accounts: Record<string, Record<string, ContactMemory>>
  latestNames: Record<string, {name: string | null; createdAt: number}>
  observeProfile: (pubkey: string, name: string | null, createdAt: number) => void
  remember: (account: string, pubkey: string) => void
  setFavorite: (account: string, pubkey: string, favorite: boolean) => void
  approveName: (
    account: string,
    pubkey: string,
    expectedName: string,
    nowSecs?: number
  ) => void
}

// Local account-scoped data. Never include it in public profile or follow events.
export const useContactMemoryStore = create<ContactMemoryState>()(
  persist(
    (set) => ({
      accounts: {},
      latestNames: {},
      observeProfile: (pubkey, name, createdAt) =>
        set((state) => {
          const latest = state.latestNames[pubkey]
          if (latest && latest.createdAt >= createdAt) return state
          const accounts = {...state.accounts}
          for (const [account, contacts] of Object.entries(accounts)) {
            const memory = contacts[pubkey]
            if (!memory) continue
            const next = observeContactName(memory, name)
            if (next !== memory) accounts[account] = {...contacts, [pubkey]: next}
          }
          return {
            accounts,
            latestNames: {...state.latestNames, [pubkey]: {name, createdAt}},
          }
        }),
      remember: (account, pubkey) =>
        set((state) => {
          if (!account || !pubkey || account === pubkey) return state
          const contacts = state.accounts[account] ?? {}
          const current = contacts[pubkey]
          const memory = observeContactName(
            current ?? emptyContactMemory(),
            state.latestNames[pubkey]?.name ?? null
          )
          if (memory === current) return state
          return {
            accounts: {...state.accounts, [account]: {...contacts, [pubkey]: memory}},
          }
        }),
      setFavorite: (account, pubkey, favorite) =>
        set((state) => {
          if (!account || !pubkey || account === pubkey) return state
          const contacts = state.accounts[account] ?? {}
          const memory = observeContactName(
            contacts[pubkey] ?? emptyContactMemory(),
            state.latestNames[pubkey]?.name ?? null
          )
          return {
            accounts: {
              ...state.accounts,
              [account]: {...contacts, [pubkey]: setContactFavorite(memory, favorite)},
            },
          }
        }),
      approveName: (
        account,
        pubkey,
        expectedName,
        nowSecs = Math.floor(Date.now() / 1000)
      ) =>
        set((state) => {
          const contacts = state.accounts[account]
          const memory = contacts?.[pubkey]
          if (!memory) return state
          const next = approveContactName(
            memory,
            expectedName,
            state.latestNames[pubkey]?.name ?? null,
            nowSecs
          )
          if (next === memory) return state
          return {accounts: {...state.accounts, [account]: {...contacts, [pubkey]: next}}}
        }),
    }),
    {
      name: "contact-memory-storage",
      partialize: (state) => ({accounts: state.accounts}),
    }
  )
)
