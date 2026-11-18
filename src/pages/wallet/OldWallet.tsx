import RightColumn from "@/shared/components/RightColumn"
import PopularWidget from "@/shared/components/feed/PopularWidget"
import {useEffect, useState} from "react"
import {getRecoveryMountRoot} from "@/navigation/recoveryMount"

export default function OldWallet() {
  const [ready, setReady] = useState(false)
  // Keep the existing /cashu/ registration and offline caches on the apex.
  const walletBase = getRecoveryMountRoot()
    ? "/cashu/"
    : `${import.meta.env.BASE_URL}cashu/`
  useEffect(() => {
    let mounted = true
    const loader = new URL(`${walletBase}offline.js`, document.baseURI).href
    import(/* @vite-ignore */ loader)
      .then(({updateLegacyWallet}) => updateLegacyWallet())
      .catch(() => {}) // A previously cached wallet remains available offline.
      .finally(() => {
        if (mounted) setReady(true)
      })
    return () => {
      mounted = false
    }
  }, [walletBase])
  return (
    <div className="flex justify-center h-screen">
      <div className="flex-1 overflow-hidden">
        {ready && (
          <iframe
            src={`${walletBase}index.html`}
            title="Legacy Cashu Wallet"
            className="w-full h-full border-0"
          />
        )}
      </div>
      <RightColumn>
        <PopularWidget className="h-auto" />
      </RightColumn>
    </div>
  )
}
