import {useEffect, useState} from "react"
import {useUIStore} from "@/stores/ui"

const InstallPWAPrompt = () => {
  const [showPrompt, setShowPrompt] = useState(false)
  const {hidePWAPrompt: hidePrompt, setHidePWAPrompt: setHidePrompt} = useUIStore()
  const [isAndroid, setIsAndroid] = useState(false)

  useEffect(() => {
    const userAgent = window.navigator.userAgent.toLowerCase()
    const isIosSafari = /iphone|ipod/.test(userAgent) && /safari/.test(userAgent)
    const isChromeOnAndroid =
      /android/.test(userAgent) &&
      /chrome/.test(userAgent) &&
      !/edge|edg|opr|opera/.test(userAgent)

    const isInStandaloneMode =
      window.matchMedia("(display-mode: standalone)").matches ||
      ("standalone" in window.navigator &&
        (window.navigator as Navigator & {standalone: boolean}).standalone)

    if ((isIosSafari || isChromeOnAndroid) && !isInStandaloneMode && !hidePrompt) {
      setIsAndroid(isChromeOnAndroid)
      setShowPrompt(true)
    } else {
      setShowPrompt(false)
    }
  }, [hidePrompt])

  const onHide = () => {
    setShowPrompt(false)
    setHidePrompt(true)
  }

  if (!showPrompt) return null

  return (
    <div className="fixed bottom-0 left-0 right-0 mx-auto z-50 text-center flex flex-col items-center justify-center animate-bounce">
      <div className="inline-flex items-center bg-black text-white px-4 py-2 rounded-lg border border-gray-300">
        <span>
          Tap {isAndroid ? <MoreVertIcon /> : <ShareIcon />} and{" "}
          <strong>Add to Home Screen</strong> <br />
          {!isAndroid && <small>for notifications</small>}
        </span>
        <button onClick={onHide} className="ml-2 p-1">
          ✕
        </button>
      </div>
      <div className="w-0 h-0 border-l-[10px] border-l-transparent border-r-[10px] border-r-transparent border-t-[10px] border-t-white mt-1" />
    </div>
  )
}

const MoreVertIcon = () => (
  <svg className="inline-block w-4 h-4 mx-1" viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z" />
  </svg>
)

const ShareIcon = () => (
  <svg className="inline-block w-4 h-4 mx-1" viewBox="0 0 24 24" fill="currentColor">
    <path d="M16 5l-1.42 1.42-1.59-1.59V16h-1.98V4.83L9.42 6.42 8 5l4-4 4 4zm4 5v11c0 1.1-.9 2 -2 2H6c-1.11 0-2-.9-2-2V10c0-1.11.89-2 2-2h3v2H6v11h12V10h-3V8h3c1.1 0 2 .89 2 2z" />
  </svg>
)

export default InstallPWAPrompt
