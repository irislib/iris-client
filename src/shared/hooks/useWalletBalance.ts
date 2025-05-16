import {useWebLNProvider} from "./useWebLNProvider"
import {useWalletStore} from "@/stores/wallet"
import {useUserStore} from "@/stores/user"
import {useEffect} from "react"

export const useWalletBalance = () => {
  const isWalletConnect = useUserStore((state) => state.walletConnect)
  const {balance, setBalance, provider, setProvider} = useWalletStore()
  const webLNProvider = useWebLNProvider()

  useEffect(() => {
    setProvider(webLNProvider)
  }, [webLNProvider])

  useEffect(() => {
    if (provider) {
      const updateBalance = async () => {
        const balanceInfo = await provider.getBalance()
        setBalance(balanceInfo.balance)
      }
      updateBalance()

      if (provider.on) {
        provider.on("accountChanged", updateBalance)
        return () => {
          provider.off?.("accountChanged", updateBalance)
        }
      }
    } else {
      setBalance(null)
    }
  }, [provider])

  return {balance, isWalletConnect}
}
