import {useCallback, useEffect, useRef, useState} from "react"

// Relay history arrives in bursts. Wake an empty feed when candidates arrive,
// without rendering once for every event in a large subscription.
export default function useCandidateRevision() {
  const [revision, setRevision] = useState(0)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const notify = useCallback(() => {
    if (timer.current !== undefined) return
    timer.current = setTimeout(() => {
      timer.current = undefined
      setRevision((value) => value + 1)
    }, 100)
  }, [])
  useEffect(() => () => clearTimeout(timer.current), [])
  return {revision, notify}
}
