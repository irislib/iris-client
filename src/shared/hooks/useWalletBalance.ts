import {useWebLNProvider} from "./useWebLNProvider"
import {WebLNProvider} from "@/types/global"
import {useState, useEffect} from "react"
import {useUserStore} from "@/stores/user"

export const useWalletBalance = () => {
  const isWalletConnect = useUserStore((state) => state.walletConnect)
  const [balance, setBalance] = useState<number | null>(null)
  const webLNProvider = useWebLNProvider()
  const [provider, setProvider] = useState<WebLNProvider | null>(null)

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
