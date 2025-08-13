import RightColumn from "@/shared/components/RightColumn.tsx"
import AlgorithmicFeed from "@/shared/components/feed/AlgorithmicFeed"
import Widget from "@/shared/components/ui/Widget"
import {useUserStore} from "@/stores/user"
import {useWalletProviderStore} from "@/stores/walletProvider"
import {useNavigate, useLocation} from "@/navigation"
import {useEffect} from "react"

export default function WalletPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const myPubKey = useUserStore((state) => state.publicKey)
  const activeProviderType = useWalletProviderStore((state) => state.activeProviderType)
  const activeNWCId = useWalletProviderStore((state) => state.activeNWCId)
  const nwcConnections = useWalletProviderStore((state) => state.nwcConnections)

  const isLocalCashuWallet =
    activeProviderType === "nwc" &&
    activeNWCId &&
    nwcConnections.find((conn) => conn.id === activeNWCId)?.isLocalCashuWallet

  // Only show iframe when we're actually on the wallet page
  const isWalletPage = location.pathname === "/wallet"

  useEffect(() => {
    if (!isLocalCashuWallet) {
      navigate("/settings/wallet", {replace: true})
    }
  }, [navigate, isLocalCashuWallet])

  if (!isLocalCashuWallet) {
    return null
  }

  return (
    <div className="flex justify-center h-screen">
      <div className="flex-1 overflow-hidden">
        {myPubKey && (
          <div className="w-full h-full">
            <style>{`
              iframe[title="Background Cashu Wallet"] {
                position: absolute !important;
                width: 100% !important;
                height: 100% !important;
                top: 0 !important;
                left: 0 !important;
                z-index: 10 !important;
                pointer-events: auto !important;
                display: ${isWalletPage ? "block" : "none"} !important;
              }
            `}</style>
          </div>
        )}
      </div>
      <RightColumn>
        {() => (
          <>
            <Widget title="Popular" className="h-96">
              <AlgorithmicFeed
                type="popular"
                displayOptions={{
                  small: true,
                  showDisplaySelector: false,
                }}
              />
            </Widget>
          </>
        )}
      </RightColumn>
    </div>
  )
}
