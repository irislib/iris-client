import RightColumn from "@/shared/components/RightColumn.tsx"
import Trending from "@/shared/components/feed/Trending.tsx"
import {useLocalState} from "irisdb-hooks/src/useLocalState"
import Widget from "@/shared/components/ui/Widget"
import {useNavigate} from "react-router"

export default function WalletPage() {
  const [myPubKey] = useLocalState("user/publicKey", "")
  const [isWalletConnect] = useLocalState("user/walletConnect", false)
  const navigate = useNavigate()

  if (isWalletConnect) {
    navigate("/settings/wallet", {replace: true})
  }

  return (
    <div className="flex justify-center h-screen">
      <div className="flex-1 overflow-hidden">
        {myPubKey && (
          <iframe
            src="/cashu"
            className="w-full h-full border-none"
            title="Cashu Wallet"
          />
        )}
      </div>
      <RightColumn>
        {() => (
          <>
            <Widget title="Trending posts">
              <Trending />
            </Widget>
          </>
        )}
      </RightColumn>
    </div>
  )
}
