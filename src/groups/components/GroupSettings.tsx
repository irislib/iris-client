import Modal from "@/shared/components/ui/Modal"
import {usePublicKey} from "@/stores/user"
import type {Group} from "../model"
import type {GroupView} from "../useGroup"

export default function GroupSettings({
  group,
  view,
  onViewChange,
  onEdit,
  onClose,
}: {
  group: Group
  view: GroupView
  onViewChange: (view: GroupView) => void
  onEdit?: () => void
  onClose: () => void
}) {
  const publicKey = usePublicKey()
  return (
    <Modal onClose={onClose}>
      <div className="mx-auto max-w-xl space-y-6">
        <h2 className="text-xl font-semibold pr-10">Group settings</h2>
        {onEdit && (
          <button className="btn btn-ghost" onClick={onEdit}>
            Edit group
          </button>
        )}
        <details className="text-sm text-base-content/65">
          <summary className="cursor-pointer">Advanced</summary>
          <div className="pt-4 space-y-4">
            <label className="flex flex-wrap items-center justify-between gap-3">
              Membership network
              <select
                aria-label="Trust view"
                className="select select-bordered select-sm"
                value={view}
                onChange={(event) => onViewChange(event.target.value as GroupView)}
              >
                <option value="creator">Group’s network</option>
                {publicKey && <option value="personal">My network</option>}
              </select>
            </label>
            <p>
              Membership needs {group.policy.direct} direct confirmation
              {group.policy.direct === 1 ? "" : "s"}, or {group.policy.secondDegree}{" "}
              confirmations through independent contacts in this network.
            </p>
            <p>Polls keep the member list from when they open.</p>
          </div>
        </details>
        <div className="flex justify-end">
          <button className="btn btn-primary btn-sm" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </Modal>
  )
}
