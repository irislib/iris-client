import {watchZappedAmount} from "@/utils/nostr"
import {AppEvent} from "@/lib/nostr"
import {useEffect, useState} from "react"
import HyperText from "../HyperText"

interface ZapraiserProps {
  event: AppEvent
  truncate?: number
}

function Zapraiser({event, truncate}: ZapraiserProps) {
  const [zapProgress, setZapProgress] = useState(0)

  useEffect(() => {
    setZapProgress(0)
    const targetAmount = Number(event.tagValue("zapraiser"))
    if (!(targetAmount > 0)) return
    return watchZappedAmount(event, (amount) =>
      setZapProgress(Math.min(100, Math.round((amount / targetAmount) * 100)))
    )
  }, [event])

  return (
    <div className="flex flex-col gap-2 px-4">
      <HyperText truncate={truncate}>{event.content}</HyperText>
      <div className="flex flex-col gap-2 mt-4 mb-2">
        <p className="self-center">Zap Goal {zapProgress} %</p>
        <div className="w-full h-4 bg-gray-200 rounded">
          <div
            className="h-full bg-purple-500 rounded"
            style={{width: `${zapProgress}%`}}
          ></div>
        </div>
      </div>
    </div>
  )
}

export default Zapraiser
