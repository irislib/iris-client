import Modal from "@/shared/components/ui/Modal"
import {EXPIRATION_OPTIONS, getExpirationLabel} from "@/utils/expiration"

export function DisappearingMessagesModal({
  currentTtlSeconds,
  onClose,
  onSelect,
}: {
  currentTtlSeconds: number | null
  onClose: () => void
  onSelect: (ttlSeconds: number | null) => void
}) {
  const currentLabel =
    currentTtlSeconds && currentTtlSeconds > 0 ? getExpirationLabel(currentTtlSeconds) : "Off"

  return (
    <Modal onClose={onClose}>
      <div className="max-w-md mx-auto p-4 pt-12">
        <h2 className="text-xl font-semibold mb-1">Disappearing messages</h2>
        <p className="text-sm text-base-content/70 mb-4">
          New messages will disappear after the selected time.
        </p>

        <div className="text-sm text-base-content/70 mb-2">
          Current: <span className="font-medium text-base-content">{currentLabel}</span>
        </div>

        <div className="bg-base-100 border border-custom rounded-xl overflow-hidden">
          <button
            type="button"
            onClick={() => onSelect(null)}
            className="w-full text-left px-4 py-3 hover:bg-base-200 transition-colors flex items-center justify-between"
          >
            <span>Off</span>
            {currentTtlSeconds === null && <span className="text-primary">✓</span>}
          </button>

          <div className="border-t border-custom" />

          {EXPIRATION_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => onSelect(opt.value)}
              className="w-full text-left px-4 py-3 hover:bg-base-200 transition-colors flex items-center justify-between"
            >
              <span>{opt.label}</span>
              {currentTtlSeconds === opt.value && <span className="text-primary">✓</span>}
            </button>
          ))}
        </div>
      </div>
    </Modal>
  )
}

