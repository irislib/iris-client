import {persist} from "zustand/middleware"
import {create} from "zustand"

interface ZapState {
  defaultZapAmount: number

  setDefaultZapAmount: (amount: number) => void
}

export const useZapStore = create<ZapState>()(
  persist(
    (set) => {
      const initialState = {
        defaultZapAmount: 21,
      }

      const actions = {
        setDefaultZapAmount: (defaultZapAmount: number) => set({defaultZapAmount}),
      }

      return {
        ...initialState,
        ...actions,
      }
    },
    {
      name: "zap-storage",
    }
  )
)

export const useDefaultZapAmount = () => useZapStore((state) => state.defaultZapAmount)
