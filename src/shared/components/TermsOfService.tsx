import {useState} from "react"
import TermsContent from "@/shared/components/TermsContent"
import {resolveAppAssetUrl} from "@/utils/nativeHtree"

interface TermsOfServiceProps {
  onAccept: () => void
}

export default function TermsOfService({onAccept}: TermsOfServiceProps) {
  const [accepted, setAccepted] = useState(false)
  const iconUrl = resolveAppAssetUrl("/img/icon128.png")

  const handleAccept = () => {
    if (accepted) {
      onAccept()
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 md:p-4">
      <div className="w-full h-full md:h-auto md:max-w-2xl md:max-h-[90vh] bg-neutral-900 md:rounded-lg shadow-xl flex flex-col pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
        <div className="p-6 text-center flex-shrink-0">
          <div className="flex items-center justify-center gap-3 mb-4">
            <img src={iconUrl} alt="Iris" className="w-10 h-10" />
            <h2 className="text-2xl font-bold">Iris Terms of Service</h2>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto text-left text-sm text-neutral-300 px-6 py-4 bg-neutral-950 mx-6 mb-6 rounded">
          <TermsContent />
        </div>

        <div className="p-6 flex-shrink-0">
          <div className="flex items-center justify-center mb-4">
            <label className="flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={accepted}
                onChange={(e) => setAccepted(e.target.checked)}
                className="w-5 h-5 mr-3 accent-iris-500"
              />
              <span className="text-sm">
                I have read and agree to the Terms of Service
              </span>
            </label>
          </div>

          <button
            onClick={handleAccept}
            disabled={!accepted}
            className={`w-full py-3 px-6 rounded-lg font-medium transition ${
              accepted
                ? "btn-primary"
                : "bg-neutral-700 text-neutral-500 cursor-not-allowed"
            }`}
          >
            Continue
          </button>
        </div>
      </div>
    </div>
  )
}
