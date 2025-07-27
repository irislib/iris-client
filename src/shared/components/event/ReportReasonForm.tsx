import {ChangeEvent, Dispatch, SetStateAction, useCallback, useState} from "react"
import {NostrEvent} from "nostr-tools"

type Hexpubkey = string

import {submitReport} from "@/shared/services/Mute.tsx"

interface ReportReasonFormProps {
  event?: NostrEvent
  user: Hexpubkey
  setReported: Dispatch<SetStateAction<boolean>>
}

function ReportReasonForm({user, event, setReported}: ReportReasonFormProps) {
  const [reportContent, setReportContent] = useState("")
  const [reason, setReason] = useState<string>("")
  const [buttonDisabled, setButtonDisabled] = useState(true)

  const handleTextChange = useCallback(
    (event: ChangeEvent<HTMLTextAreaElement>) => setReportContent(event.target.value),
    []
  )
  const handleReasonChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const selectedReason = event.target.value
    setReason(selectedReason)
    setButtonDisabled(selectedReason === "")
  }

  const handleReport = async () => {
    try {
      if (user) await submitReport(reason, reportContent, user, event?.id)
      setReported(true)
    } catch (error) {
      console.error("Error submitting report: ", error)
      setReported(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="form-control w-full">
        <label className="label">
          <span className="label-text">Reason</span>
        </label>
        <select
          className="select select-bordered"
          onChange={handleReasonChange}
          value={reason}
        >
          <option value="" disabled>
            Select a reason
          </option>
          <option value="Illegal Material">Illegal Material</option>
          <option value="Harrassment">Harrassment</option>
          <option value="Spam">Spam</option>
          <option value="Bot Activity">Bot Activity</option>
        </select>
      </div>
      {!buttonDisabled && (
        <>
          <textarea
            className="textarea textarea-bordered h-24"
            onChange={handleTextChange}
            placeholder="Additional Details (optional)"
          />
          <button onClick={handleReport} className="btn btn-primary">
            Submit
          </button>
        </>
      )}
    </div>
  )
}

export default ReportReasonForm
