import {profilePerformanceTest} from "@/utils/performanceTest"
import {useEffect, useRef} from "react"

export function useProfilePerformance(pubKey: string, profile: unknown) {
  const startTimeRef = useRef<number>(0)
  const hasStartedRef = useRef<boolean>(false)

  useEffect(() => {
    if (pubKey && !hasStartedRef.current) {
      profilePerformanceTest.startProfileTest(pubKey)
      startTimeRef.current = performance.now()
      hasStartedRef.current = true
    }
  }, [pubKey])

  useEffect(() => {
    if (profile && pubKey && hasStartedRef.current) {
      profilePerformanceTest.endProfileTest(pubKey)
      hasStartedRef.current = false
    }
  }, [profile, pubKey])

  useEffect(() => {
    return () => {
      hasStartedRef.current = false
    }
  }, [])
}
