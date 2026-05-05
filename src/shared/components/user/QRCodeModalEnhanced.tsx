import {useEffect, useState, useMemo, lazy, Suspense} from "react"
import useProfile from "@/shared/hooks/useProfile"
import {Avatar} from "@/shared/components/user/Avatar"
import {Name} from "@/shared/components/user/Name"
import Icon from "@/shared/components/Icons/Icon"
import Modal from "@/shared/components/ui/Modal"
import {RiArrowLeftLine, RiFlashlightFill} from "@remixicon/react"
import {generateProxyUrl} from "@/shared/utils/imgproxy"

const QRScanner = lazy(() => import("@/shared/components/QRScanner"))
import ostrichBlack from "@/assets/ostrich-black.png"
import {useNavigate} from "@/navigation"

interface QRCodeModalEnhancedProps {
  onClose: () => void
  data: string
  pubKey: string
}

function QRCodeModalEnhanced({onClose, data, pubKey}: QRCodeModalEnhancedProps) {
  const [qrCodeUrl, setQrCodeUrl] = useState<string>("")
  const [lightningQrCodeUrl, setLightningQrCodeUrl] = useState<string>("")
  const [activeTab, setActiveTab] = useState<"npub" | "lightning">("npub")
  const [showScanner, setShowScanner] = useState(false)
  const [showCopied, setShowCopied] = useState(false)
  const profile = useProfile(pubKey)
  const navigate = useNavigate()

  const npub = data.startsWith("nostr:") ? data.slice(6) : data
  const hasLightningAddress = !!profile?.lud16

  const displayValue = useMemo(() => {
    if (activeTab === "npub") {
      return npub.length > 30 ? `${npub.slice(0, 15)}...${npub.slice(-15)}` : npub
    }
    const lud16 = profile?.lud16
    if (!lud16) return ""
    return lud16.length > 30 ? `${lud16.slice(0, 15)}...${lud16.slice(-15)}` : lud16
  }, [activeTab, npub, profile?.lud16])

  // Generate proxy URL for banner if available
  const bannerProxyUrl = useMemo(() => {
    if (!profile?.banner) return null
    return generateProxyUrl(profile.banner, {width: 655})
  }, [profile?.banner])

  useEffect(() => {
    const generateQR = async () => {
      try {
        const QRCode = await import("qrcode")
        // Generate npub QR with high error correction for logo overlay
        const npubUrl = await new Promise((resolve, reject) => {
          QRCode.toDataURL(
            data,
            {
              errorCorrectionLevel: "H",
              margin: 0,
              width: 256,
              color: {
                dark: "#000000",
                light: "#FFFFFF",
              },
            },
            (error, url) => {
              if (error) reject(error)
              else resolve(url)
            }
          )
        })
        setQrCodeUrl(npubUrl as string)

        // Generate lightning QR with high error correction if available
        if (profile?.lud16) {
          const lightningUrl = await new Promise((resolve, reject) => {
            QRCode.toDataURL(
              `lightning:${profile.lud16}`,
              {
                errorCorrectionLevel: "H",
                margin: 0,
                width: 256,
                color: {
                  dark: "#000000",
                  light: "#FFFFFF",
                },
              },
              (error, url) => {
                if (error) reject(error)
                else resolve(url)
              }
            )
          })
          setLightningQrCodeUrl(lightningUrl as string)
        }
      } catch (error) {
        console.error("Error generating QR code:", error)
      }
    }
    generateQR()
  }, [data, profile?.lud16])

  const [randomGradient] = useState(() => {
    const gradientColors = [
      "from-orange-400 via-pink-500 to-purple-600",
      "from-blue-400 via-purple-500 to-pink-500",
      "from-green-400 via-blue-500 to-purple-600",
      "from-yellow-400 via-red-500 to-pink-500",
      "from-indigo-400 via-purple-500 to-pink-500",
    ]
    return gradientColors[Math.floor(Math.random() * gradientColors.length)]
  })

  const handleCopy = () => {
    const textToCopy = activeTab === "npub" ? npub : profile?.lud16 || ""
    navigator.clipboard.writeText(textToCopy)
    setShowCopied(true)
    setTimeout(() => setShowCopied(false), 2000)
  }

  const handleQRScanSuccess = (result: string) => {
    setShowScanner(false)

    // Handle different QR code formats
    if (result.startsWith("nostr:")) {
      const identifier = result.slice(6)
      if (identifier.startsWith("npub")) {
        navigate(`/${identifier}`)
        onClose()
      } else if (identifier.startsWith("note")) {
        navigate(`/post/${identifier}`)
        onClose()
      }
    } else if (result.startsWith("lightning:")) {
      // Handle lightning addresses if needed
      const lnAddress = result.slice(10)
      navigator.clipboard.writeText(lnAddress)
    } else if (result.startsWith("npub")) {
      navigate(`/${result}`)
      onClose()
    } else if (result.startsWith("note")) {
      navigate(`/post/${result}`)
      onClose()
    }
  }

  if (showScanner) {
    const scannerContent = (
      <div className="h-screen w-screen md:h-[700px] md:w-[500px] flex flex-col relative overflow-hidden md:rounded-lg">
        {/* Background with gradient */}
        <div className={`absolute inset-0 bg-gradient-to-br ${randomGradient}`} />

        {/* Content overlay */}
        <div className="relative z-10 flex flex-col h-full">
          {/* Header with back button */}
          <button
            onClick={() => setShowScanner(false)}
            className="absolute top-[calc(0.5rem+env(safe-area-inset-top))] left-2 z-20 flex items-center justify-center text-white p-2 rounded-lg transition-colors hover:bg-white/10 qr-modal-shadow-btn"
            aria-label="Go back"
          >
            <RiArrowLeftLine className="w-7 h-7" />
          </button>

          <div className="text-center pt-[calc(0.8rem+env(safe-area-inset-top))] pb-4">
            <h1 className="text-2xl font-semibold text-white">Scan QR Code</h1>
          </div>

          {/* Main content */}
          <div className="flex-1 flex flex-col items-center justify-center px-6">
            {/* Scanner area */}
            <div className="bg-white rounded-2xl p-1 mb-8 shadow-2xl">
              <div className="w-80 h-80 rounded-2xl overflow-hidden relative">
                <Suspense
                  fallback={
                    <div className="flex items-center justify-center w-full h-full">
                      Loading...
                    </div>
                  }
                >
                  <QRScanner onScanSuccess={handleQRScanSuccess} />
                </Suspense>
              </div>
            </div>

            <p className="text-white text-center mb-8">
              Scan a user&apos;s QR code
              <br />
              to find them on Nostr
            </p>
          </div>

          {/* Bottom button */}
          <div className="px-6 pb-6">
            <button
              className="w-full bg-white/20 backdrop-blur-sm text-white font-semibold py-4 rounded-full shadow-lg border border-white/30"
              onClick={() => setShowScanner(false)}
            >
              View QR Code
            </button>
          </div>
        </div>
      </div>
    )

    return (
      <Modal onClose={() => setShowScanner(false)} hasBackground={false}>
        {scannerContent}
      </Modal>
    )
  }

  const content = (
    <div className="h-screen w-screen md:h-[700px] md:w-[500px] flex flex-col relative overflow-hidden md:rounded-lg">
      {/* Background with gradient as base */}
      <div className={`absolute inset-0 bg-gradient-to-br ${randomGradient}`} />

      {/* Banner overlay if available */}
      {bannerProxyUrl && (
        <div
          className="absolute inset-0"
          style={{
            backgroundImage: `linear-gradient(rgba(0,0,0,0.3), rgba(0,0,0,0.5)), url(${bannerProxyUrl})`,
            backgroundSize: "cover",
            backgroundPosition: "center",
            filter: "blur(8px)",
            transform: "scale(1.1)",
            transformOrigin: "center",
          }}
        />
      )}

      {/* Content overlay */}
      <div className="relative z-10 flex flex-col h-full overflow-y-auto overflow-x-hidden">
        {/* Header with close button - absolute positioned */}
        <button
          onClick={onClose}
          className="absolute top-[calc(0.5rem+env(safe-area-inset-top))] left-2 z-20 flex items-center justify-center text-white p-2 rounded-lg transition-colors hover:bg-white/10 qr-modal-shadow-btn"
          aria-label="Go back"
        >
          <RiArrowLeftLine className="w-7 h-7" />
        </button>

        {/* Main content */}
        <div className="flex-1 flex flex-col items-center justify-center px-6 pt-6 pb-6">
          {/* Profile section */}
          <div className="flex flex-col items-center mb-6">
            <div className="rounded-full border-4 border-white shadow-xl mb-4 overflow-hidden">
              <Avatar
                pubKey={pubKey}
                width={96}
                showBadge={false}
                showHoverCard={false}
              />
            </div>
            <h1 className="text-2xl font-bold text-white mb-1 qr-modal-shadow">
              <Name pubKey={pubKey} />
            </h1>
            {profile?.nip05 && (
              <p className="text-white/80 text-sm qr-modal-shadow-sm">
                {profile.nip05.replace("_@", "")}
              </p>
            )}
          </div>

          {/* Tab buttons */}
          <div className="flex gap-8 mb-6">
            <button
              className={`text-white font-semibold pb-2 qr-modal-shadow-sm ${
                activeTab === "npub" ? "border-b-2 border-white" : "text-white/60"
              }`}
              onClick={() => setActiveTab("npub")}
            >
              PUBLIC KEY
            </button>
            {hasLightningAddress && (
              <button
                className={`text-white font-semibold pb-2 qr-modal-shadow-sm ${
                  activeTab === "lightning" ? "border-b-2 border-white" : "text-white/60"
                }`}
                onClick={() => setActiveTab("lightning")}
              >
                LIGHTNING ADDRESS
              </button>
            )}
          </div>

          {/* QR Code */}
          <div className="bg-white rounded-2xl p-4 mb-6 shadow-2xl w-72 h-72 flex items-center justify-center relative">
            {activeTab === "npub" && qrCodeUrl && (
              <div className="relative">
                <img src={qrCodeUrl} alt="Public Key QR Code" className="w-64 h-64" />
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div className="bg-black rounded-full p-3 shadow-lg border-4 border-white overflow-hidden">
                    <img src={ostrichBlack} alt="" className="w-8 h-8" />
                  </div>
                </div>
              </div>
            )}
            {activeTab === "lightning" && lightningQrCodeUrl && (
              <div className="relative">
                <img
                  src={lightningQrCodeUrl}
                  alt="Lightning Address QR Code"
                  className="w-64 h-64"
                />
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div className="bg-black rounded-full p-3 shadow-lg border-4 border-white">
                    <RiFlashlightFill className="w-8 h-8 text-white" />
                  </div>
                </div>
              </div>
            )}
            {!(
              (activeTab === "npub" && qrCodeUrl) ||
              (activeTab === "lightning" && lightningQrCodeUrl)
            ) && <div className="w-64 h-64 animate-pulse bg-gray-200 rounded" />}
          </div>

          {/* Value with copy button */}
          <div
            className="relative flex items-center gap-2 bg-white/10 backdrop-blur-sm rounded-lg px-4 py-2 mb-6 cursor-pointer hover:bg-white/20 transition-colors"
            onClick={handleCopy}
          >
            <p
              className={`text-white text-sm font-mono ${showCopied ? "invisible" : ""}`}
            >
              {displayValue}
            </p>
            <div className={`text-white p-1 ${showCopied ? "invisible" : ""}`}>
              <Icon name="copy" className="w-4 h-4" />
            </div>
            {showCopied && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <span className="text-white text-sm">Copied</span>
              </div>
            )}
          </div>

          {/* Scan QR Code button */}
          <button
            className="bg-white text-black font-semibold py-3 px-8 rounded-full shadow-lg"
            onClick={() => setShowScanner(true)}
          >
            Scan QR Code
          </button>
        </div>
      </div>
    </div>
  )

  return (
    <Modal onClose={onClose} hasBackground={false}>
      {content}
    </Modal>
  )
}

export default QRCodeModalEnhanced
