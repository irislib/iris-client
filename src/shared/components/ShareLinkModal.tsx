import {useEffect, useState} from "react"
import Modal from "./ui/Modal"

export default function ShareLinkModal({
  title,
  url,
  onClose,
}: {
  title: string
  url: string
  onClose: () => void
}) {
  const [qr, setQr] = useState("")
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState("")
  useEffect(() => {
    let cancelled = false
    setQr("")
    setCopied(false)
    setError("")
    import("qrcode")
      .then((code) => code.toDataURL(url, {width: 512, margin: 4}))
      .then((image) => {
        if (!cancelled) setQr(image)
      })
      .catch(() => {
        if (!cancelled) setError("Couldn’t create the QR code. Copy the link instead.")
      })
    return () => {
      cancelled = true
    }
  }, [url])
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setError("")
    } catch {
      setError("Select and copy the link below.")
    }
  }
  return (
    <Modal onClose={onClose}>
      <div className="w-full max-w-sm mx-auto flex flex-col items-center gap-5 p-2">
        <h2 className="text-xl font-semibold pr-8 self-start">{title}</h2>
        <div className="w-64 max-w-full aspect-square">
          {qr && <img src={qr} alt="QR code" className="w-full rounded-xl" />}
        </div>
        {error && (
          <p role="alert" className="text-sm text-error">
            {error}
          </p>
        )}
        <input
          aria-label="Link"
          className="input input-bordered w-full text-sm"
          readOnly
          value={url}
          onFocus={(event) => event.target.select()}
        />
        <button className="btn btn-primary" onClick={copy}>
          {copied ? "Copied" : "Copy link"}
        </button>
      </div>
    </Modal>
  )
}
