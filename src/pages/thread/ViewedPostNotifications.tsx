import {useEffect, type RefObject} from "react"
import {useIsTopOfStack} from "@/navigation/useIsTopOfStack"
import {usePublicKey} from "@/stores/user"
import {useNotificationsStore} from "@/stores/notifications"
import {clearNotifications, readPostNotifications} from "@/utils/notifications"

export default function ViewedPostNotifications({
  postId,
  postRef,
}: {
  postId: string
  postRef: RefObject<HTMLDivElement | null>
}) {
  const publicKey = usePublicKey()
  const active = useIsTopOfStack()

  useEffect(() => {
    if (!active || !publicKey || !postRef.current) return
    let inView = false
    const onView = () => {
      if (!inView || document.visibilityState !== "visible") return
      readPostNotifications(publicKey, postId)
      void clearNotifications({publicKey, postId})
    }
    const observer = new IntersectionObserver(([entry]) => {
      inView = entry.isIntersecting
      onView()
    })
    observer.observe(postRef.current)
    document.addEventListener("visibilitychange", onView)
    // The relay may deliver activity after the post has already rendered.
    const unsubscribe = useNotificationsStore.subscribe((state, previous) => {
      if (
        inView &&
        document.visibilityState === "visible" &&
        (state.latestNotification !== previous.latestNotification ||
          state.refreshRouteSignal !== previous.refreshRouteSignal)
      ) {
        readPostNotifications(publicKey, postId)
      }
    })
    return () => {
      document.removeEventListener("visibilitychange", onView)
      observer.disconnect()
      unsubscribe()
    }
  }, [active, postId, postRef, publicKey])
  return null
}
