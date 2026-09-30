import {ChangeEvent, useCallback, useState} from "react"
import {Hexpubkey, AppEvent} from "@/lib/nostr"

import {flagUser, muteUser} from "@/shared/services/Mute.tsx"
import {getMuteLabel} from "@/utils/muteLabels"

interface ReportReasonFormProps {
  event?: AppEvent
  user: Hexpubkey
  setReported: () => void
}

function ReportReasonForm({user, event, setReported}: ReportReasonFormProps) {
  const [reportContent, setReportContent] = useState("")
  const [reason, setReason] = useState<string>("")
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [shouldBlock, setShouldBlock] = useState(true)

  const handleTextChange = useCallback(
    (event: ChangeEvent<HTMLTextAreaElement>) => setReportContent(event.target.value),
    []
  )

  const handleReasonChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const selectedReason = event.target.value
    setReason(selectedReason)
  }

  const handleReport = async () => {
    try {
      setIsSubmitting(true)
      await flagUser(user, reason, reportContent, event?.id)
      if (shouldBlock) {
        await muteUser(user)
      }
      setReported()
    } catch (error) {
      console.error("Error submitting report: ", error)
    } finally {
      setIsSubmitting(false)
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
          <option value="Harassment">Harassment</option>
          <option value="Spam">Spam</option>
          <option value="Bot Activity">Bot Activity</option>
          <option value="Other">Other</option>
        </select>
      </div>

      <textarea
        className="textarea textarea-bordered h-24"
        onChange={handleTextChange}
        placeholder="Additional Details (optional)"
        value={reportContent}
      />

      <div className="form-control">
        <label className="label cursor-pointer justify-start gap-3">
          <input
            type="checkbox"
            className="checkbox checkbox-primary"
            checked={shouldBlock}
            onChange={(e) => setShouldBlock(e.target.checked)}
          />
          <span className="label-text">{getMuteLabel()} user</span>
        </label>
      </div>

      <button
        onClick={handleReport}
        className="btn btn-primary"
        disabled={isSubmitting || !reason}
      >
        {isSubmitting ? "Submitting..." : "Submit"}
      </button>
    </div>
  )
}

export default ReportReasonForm
