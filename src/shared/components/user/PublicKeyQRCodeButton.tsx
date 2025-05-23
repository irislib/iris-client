import QRCodeButton from "./QRCodeButton"
import {nip19} from "nostr-tools"
import {useMemo} from "react"

interface PublicKeyQRCodeButtonProps {
  publicKey: string
  onScanSuccess?: (data: string) => void
  "data-testid"?: string
}

function PublicKeyQRCodeButton({
  publicKey,
  onScanSuccess,
  "data-testid": dataTestId,
}: PublicKeyQRCodeButtonProps) {
  const npub = useMemo(() => {
    if (publicKey.startsWith("npub")) {
      return publicKey
    } else {
      return nip19.npubEncode(publicKey)
    }
  }, [publicKey])

  const data = `nostr:${npub}`

  return (
    <QRCodeButton data={data} onScanSuccess={onScanSuccess} data-testid={dataTestId} />
  )
}

export default PublicKeyQRCodeButton
