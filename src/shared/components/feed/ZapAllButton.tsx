import {useState} from "react"
import ZapAllModal from "./ZapAllModal"
import {AppEvent} from "@/lib/nostr"
import Icon from "../Icons/Icon"

interface ZapAllButtonProps {
  events: AppEvent[]
}

function ZapAllButton({events}: ZapAllButtonProps) {
  const [showModal, setShowModal] = useState(false)

  if (events.length === 0) {
    return null
  }

  return (
    <>
      <div
        onClick={() => setShowModal(true)}
        className="p-4 border-t border-b border-custom text-center transition-colors duration-200 ease-in-out hover:underline hover:bg-[var(--note-hover-color)] cursor-pointer flex items-center justify-center gap-2"
      >
        <span className="text-accent">
          <Icon name="zap" size={20} />
        </span>
        <span>Zap All ({events.length} posts)</span>
      </div>
      {showModal && <ZapAllModal events={events} onClose={() => setShowModal(false)} />}
    </>
  )
}

export default ZapAllButton
