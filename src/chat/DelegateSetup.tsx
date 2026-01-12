import {useState, FormEvent} from "react"
import {useDelegateDeviceStore, parsePairingCode} from "@/stores/delegateDevice"

interface DelegateSetupProps {
  onActivated: () => void
}

type SetupStep = "input" | "waiting" | "error"

export default function DelegateSetup({onActivated}: DelegateSetupProps) {
  const [step, setStep] = useState<SetupStep>("input")
  const [pairingCode, setPairingCode] = useState("")
  const [error, setError] = useState("")
  const setCredentials = useDelegateDeviceStore((s) => s.setCredentials)

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    setError("")

    try {
      const credentials = parsePairingCode(pairingCode)
      setCredentials(credentials)
      setStep("waiting")
      onActivated()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invalid pairing code")
      setStep("error")
    }
  }

  if (step === "waiting") {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen p-4 bg-base-200">
        <div className="card w-full max-w-md bg-base-100 shadow-xl">
          <div className="card-body text-center">
            <span className="loading loading-spinner loading-lg mx-auto" />
            <h2 className="card-title justify-center mt-4">Waiting for Activation</h2>
            <p className="text-base-content/70">
              Open Iris on your main device and add this delegate device.
            </p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-4 bg-base-200">
      <div className="card w-full max-w-md bg-base-100 shadow-xl">
        <div className="card-body">
          <h2 className="card-title">Setup Delegate Device</h2>
          <p className="text-base-content/70 text-sm">
            Paste the pairing code from your main Iris app to set up this device as a
            delegate for receiving encrypted messages.
          </p>

          <form onSubmit={handleSubmit} className="mt-4">
            <div className="form-control">
              <label className="label">
                <span className="label-text">Pairing Code</span>
              </label>
              <textarea
                className={`textarea textarea-bordered h-24 font-mono text-xs ${error ? "textarea-error" : ""}`}
                placeholder="Paste pairing code here..."
                value={pairingCode}
                onChange={(e) => {
                  setPairingCode(e.target.value)
                  setError("")
                  setStep("input")
                }}
              />
              {error && (
                <label className="label">
                  <span className="label-text-alt text-error">{error}</span>
                </label>
              )}
            </div>

            <div className="form-control mt-6">
              <button
                type="submit"
                className="btn btn-primary"
                disabled={!pairingCode.trim()}
              >
                Connect Device
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}
