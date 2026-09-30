import RightColumn from "@/shared/components/RightColumn"
import Widget from "@/shared/components/ui/Widget"
import AlgorithmicFeed from "@/shared/components/feed/AlgorithmicFeed"
import {useEffect, useState} from "react"

export default function OldWallet() {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    let mounted = true
    const timeout = setTimeout(() => mounted && setReady(true), 5000)
    const loader = new URL(
      `${import.meta.env.BASE_URL}cashu/offline.js`,
      document.baseURI
    ).href
    import(/* @vite-ignore */ loader)
      .then(({updateLegacyWallet}) => {
        clearTimeout(timeout)
        return updateLegacyWallet()
      })
      .catch(() => {}) // A previously cached wallet remains available offline.
      .finally(() => {
        clearTimeout(timeout)
        if (mounted) setReady(true)
      })
    return () => {
      mounted = false
      clearTimeout(timeout)
    }
  }, [])
  return (
    <div className="flex justify-center h-screen">
      <div className="flex-1 overflow-hidden">
        {ready && (
          <iframe
            src={`${import.meta.env.BASE_URL}cashu/index.html`}
            title="Legacy Cashu Wallet"
            className="w-full h-full border-0"
          />
        )}
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
