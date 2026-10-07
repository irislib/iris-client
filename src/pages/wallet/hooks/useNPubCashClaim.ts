import {useCallback, useEffect, useRef, useState} from "react"
import type {Manager} from "@/lib/cashu/core"
import {syncNPubCashPayments, type NPubCashSyncResult} from "@/lib/syncNPubCash"
import {nostr} from "@/utils/nostrClient"
import {useUserStore} from "@/stores/user"

export function useNPubCashClaim(
  myPubKey: string | null,
  manager: Manager | null,
  onRefresh: () => void
) {
  const [status, setStatus] = useState<NPubCashSyncResult>({pending: 0})
  const running = useRef<Promise<void> | null>(null)
  const generation = useRef(0)
  const refresh = useCallback(() => {
    if (running.current) return running.current
    const signer = nostr().signer
    if (!myPubKey || !manager || !signer) return Promise.resolve()
    const currentGeneration = generation.current
    const isCurrent = () =>
      generation.current === currentGeneration &&
      useUserStore.getState().publicKey === myPubKey &&
      nostr().signer === signer
    const work = async () => {
      try {
        if ((await signer.user()).pubkey !== myPubKey || !isCurrent()) return
        const next = await syncNPubCashPayments(signer, manager, isCurrent)
        if (isCurrent()) {
          setStatus(next)
          await onRefresh()
        }
      } catch {
        if (isCurrent())
          setStatus((previous) => ({
            ...previous,
            error: "Could not check npub.cash payments. Try refreshing.",
          }))
      }
    }
    const promise = work().finally(() => {
      if (running.current === promise) running.current = null
    })
    running.current = promise
    return promise
  }, [myPubKey, manager, onRefresh])

  useEffect(() => {
    generation.current++
    running.current = null
    setStatus({pending: 0})
    void refresh()
    const interval = setInterval(() => void refresh(), 60000)
    const onFocus = () => void refresh()
    window.addEventListener("online", onFocus)
    return () => {
      generation.current++
      clearInterval(interval)
      window.removeEventListener("online", onFocus)
    }
  }, [refresh])

  return {...status, refresh}
}
