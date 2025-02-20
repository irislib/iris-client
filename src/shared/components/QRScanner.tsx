import {BrowserMultiFormatReader} from "@zxing/library"
import {useEffect, useRef, useState} from "react"

interface QRScannerProps {
  onScanSuccess: (result: string) => void
}

const QRScanner = ({onScanSuccess}: QRScannerProps) => {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [qrCodeResult, setQrCodeResult] = useState("")
  const streamRef = useRef<MediaStream | null>(null)

  useEffect(() => {
    const codeReader = new BrowserMultiFormatReader()

    codeReader
      .listVideoInputDevices()
      .then((videoInputDevices) => {
        const backCamera =
          videoInputDevices.find((device) =>
            device.label.toLowerCase().includes("back")
          ) || videoInputDevices[0]
        const deviceId = backCamera.deviceId

        navigator.mediaDevices.getUserMedia({video: {deviceId}}).then((mediaStream) => {
          streamRef.current = mediaStream
          if (videoRef.current) {
            videoRef.current.srcObject = mediaStream
            codeReader.decodeFromVideoDevice(
              deviceId,
              videoRef.current,
              (result, error) => {
                if (result) {
                  const text = result.getText()
                  setQrCodeResult(text)
                  if (onScanSuccess) {
                    onScanSuccess(text)
                  }
                }
                if (error) {
                  console.log(error)
                }
              }
            )
          }
        })
      })
      .catch((err) => {
        console.error(err)
      })

    return () => {
      codeReader.reset()
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop())
      }
    }
  }, [onScanSuccess])

  return (
    <div>
      <h1 className="text-center text-2xl mb-4">Scan QR</h1>
      <video ref={videoRef} style={{width: "100%"}} />
      {qrCodeResult && <p>QR Code Result: {qrCodeResult}</p>}
    </div>
  )
}

export default QRScanner
