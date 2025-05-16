import {persist} from "zustand/middleware"
import {create} from "zustand"

import {WebLNProvider} from "@/types/global"

interface WalletState {
  balance: number | null
  provider: WebLNProvider | null

  setBalance: (balance: number | null) => void
  setProvider: (provider: WebLNProvider | null) => void
}

export const useWalletStore = create<WalletState>()(
  persist(
    (set) => {
      const initialState = {
        balance: null,
        provider: null,
      }

      const actions = {
        setBalance: (balance: number | null) => set({balance}),
        setProvider: (provider: WebLNProvider | null) => set({provider}),
      }

      return {
        ...initialState,
        ...actions,
      }
    },
    {
      name: "wallet-storage",
    }
  )
)

export const useBalance = () => useWalletStore((state) => state.balance)
export const useProvider = () => useWalletStore((state) => state.provider)
