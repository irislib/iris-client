import {Hexpubkey, AppEvent} from "@/lib/nostr"
import {useState} from "react"

import ReportReasonForm from "./ReportReasonForm.tsx"

interface ReportContentProps {
  user: Hexpubkey
  event?: AppEvent
  onClose?: () => void
}

function ReportContent({user, event, onClose}: ReportContentProps) {
  const [reported, setReported] = useState(false)

  const handleReported = () => {
    setReported(true)
    setTimeout(() => {
      onClose?.()
    }, 2000)
  }

  return (
    <div className="flex flex-col gap-4 w-full md:w-80 md:min-w-80">
      <div>
        <h1 className="text-lg font-bold mb-4">Report Content</h1>
        {reported ? (
          <div className="flex flex-col items-center justify-center h-32">
            <div className="text-center">Thank you for your report!</div>
          </div>
        ) : (
          <ReportReasonForm user={user} event={event} setReported={handleReported} />
        )}
      </div>
    </div>
  )
}

export default ReportContent
