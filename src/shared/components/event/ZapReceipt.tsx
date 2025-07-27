import {decode} from "light-bolt11-decoder"
import {NostrEvent} from "nostr-tools"
import {getTagValue} from "@/utils/nostr"
import {useEffect, useState} from "react"
import {UserRow} from "../user/UserRow"

interface ZapReceiptProps {
  event: NostrEvent
}

function ZapReceipt({event}: ZapReceiptProps) {
  const [zappedAmount, setZappedAmount] = useState<number>()

  useEffect(() => {
    const invoice = getTagValue(event, "bolt11")
    if (invoice) {
      const decodedInvoice = decode(invoice)
      const amountSection = decodedInvoice.sections.find(
        (section) => section.name === "amount"
      )
      if (amountSection && "value" in amountSection) {
        setZappedAmount(Math.floor(parseInt(amountSection.value) / 1000))
      }
    }
  }, [])

  return (
    <div>
      <div className="flex items-center gap-2 px-4">
        <p className="">Zapped {zappedAmount} sats to</p>
        <UserRow pubKey={getTagValue(event, "p") || ""} avatarWidth={30} />
      </div>
      <p>{event.content}</p>
    </div>
  )
}

export default ZapReceipt
