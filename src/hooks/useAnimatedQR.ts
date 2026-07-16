import {useState, useEffect, useRef, useCallback} from "react"
import {UR, UREncoder} from "@gandlaf21/bc-ur"
import {Buffer} from "buffer"

type Speed = "slow" | "medium" | "fast"
type Size = "small" | "medium" | "large"

interface AnimatedQROptions {
  speed?: Speed
  size?: Size
  autoStart?: boolean
}

const SPEED_MS: Record<Speed, number> = {
  slow: 500,
  medium: 250,
  fast: 150,
}

const SIZE_CHARS: Record<Size, number> = {
  small: 50,
  medium: 100,
  large: 150,
}

export function useAnimatedQR(data: string, options: AnimatedQROptions = {}) {
  const {
    speed: initialSpeed = "medium",
    size: initialSize = "small",
    autoStart = true,
  } = options

  const [currentFragment, setCurrentFragment] = useState<string>("")
  const [isAnimated, setIsAnimated] = useState(false)
  const [speed, setSpeed] = useState<Speed>(initialSpeed)
  const [size, setSize] = useState<Size>(initialSize)
  const [isRunning, setIsRunning] = useState(false)

  const intervalRef = useRef<number | null>(null)
  const encoderRef = useRef<UREncoder | null>(null)

  const cleanup = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }
  }, [])

  const start = useCallback(() => {
    if (!data) return

    cleanup()

    try {
      const buffer = Buffer.from(data)
      const ur = UR.fromBuffer(buffer)
      encoderRef.current = new UREncoder(ur, SIZE_CHARS[size], 0)

      // Check if needs animation (>1 fragment)
      const needsAnimation = encoderRef.current.fragmentsLength > 1
      setIsAnimated(needsAnimation)

      if (!needsAnimation) {
        // Single fragment, just display once
        setCurrentFragment(data)
        setIsRunning(false)
        return
      }

      // Animate through fragments
      setIsRunning(true)
      const updateFragment = () => {
        if (encoderRef.current) {
          setCurrentFragment(encoderRef.current.nextPart())
        }
      }

      // Initial fragment
      updateFragment()

      // Start interval
      intervalRef.current = window.setInterval(updateFragment, SPEED_MS[speed])
    } catch (error) {
      console.error("Failed to create animated QR:", error)
      // Fallback to static
      setCurrentFragment(data)
      setIsAnimated(false)
      setIsRunning(false)
    }
  }, [data, size, speed, cleanup])

  const stop = useCallback(() => {
    cleanup()
    setIsRunning(false)
  }, [cleanup])

  const changeSpeed = useCallback(() => {
    const speeds: Speed[] = ["fast", "medium", "slow"]
    const currentIndex = speeds.indexOf(speed)
    const nextSpeed = speeds[(currentIndex + 1) % speeds.length]
    setSpeed(nextSpeed)
  }, [speed])

  const changeSize = useCallback(() => {
    const sizes: Size[] = ["large", "medium", "small"]
    const currentIndex = sizes.indexOf(size)
    const nextSize = sizes[(currentIndex + 1) % sizes.length]
    setSize(nextSize)
  }, [size])

  // Auto-start on data change
  useEffect(() => {
    if (data && autoStart) {
      start()
    }
    return cleanup
  }, [data, size, speed, autoStart, start, cleanup])

  // Cleanup on unmount
  useEffect(() => {
    return cleanup
  }, [cleanup])

  return {
    currentFragment,
    isAnimated,
    isRunning,
    speed,
    size,
    start,
    stop,
    changeSpeed,
    changeSize,
  }
}
