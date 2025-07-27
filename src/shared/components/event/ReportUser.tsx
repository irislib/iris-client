import {NostrEvent} from "nostr-tools"

type Hexpubkey = string
import {useState} from "react"

import ReportReasonForm from "./ReportReasonForm.tsx"

interface MuteUserProps {
  user: Hexpubkey
  event?: NostrEvent
}

function ReportUser({user, event}: MuteUserProps) {
  const [reported, setReported] = useState(false)
  return (
    <div className="MuteUser-root">
      <div className="Report-root flex-col">
        <h2>Would you like to submit a report?</h2>
        {reported ? (
          <div className="report-status ">Thank you for your report!</div>
        ) : (
          <ReportReasonForm user={user} event={event} setReported={setReported} />
        )}
      </div>
    </div>
  )
}

export default ReportUser
