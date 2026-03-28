import RightColumn from "@/shared/components/RightColumn"
import Widget from "@/shared/components/ui/Widget"
import AlgorithmicFeed from "@/shared/components/feed/AlgorithmicFeed"

export default function OldWallet() {
  return (
    <div className="flex justify-center h-screen">
      <div className="flex-1 overflow-hidden">
        <iframe
          src={`${import.meta.env.BASE_URL}cashu/index.html`}
          title="Legacy Cashu Wallet"
          className="w-full h-full border-0"
        />
      </div>
      <RightColumn>
        {() => (
          <Widget title="Popular">
            <AlgorithmicFeed
              type="popular"
              displayOptions={{
                small: true,
                showDisplaySelector: false,
              }}
            />
          </Widget>
        )}
      </RightColumn>
    </div>
  )
}
