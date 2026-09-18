import {type ReactNode} from "react"
import {RiLockFill} from "@remixicon/react"
import {Helmet} from "react-helmet"
import {useLocation} from "@/navigation"
import Header from "@/shared/components/header/Header"
import {useDevicesStore} from "@/stores/devices"
import {useUserStore} from "@/stores/user"
import {useUIStore} from "@/stores/ui"
import {hasWriteAccessForState} from "@/utils/auth"
import RegisterDevice from "../devices/RegisterDevice"

export default function ChatRegistrationGate({children}: {children: ReactNode}) {
  const {pathname} = useLocation()
  const publicKey = useUserStore((state) => state.publicKey)
  const hasWriteAccess = useUserStore(hasWriteAccessForState)
  const linkedDevice = useUserStore((state) => state.linkedDevice)
  const setShowLoginDialog = useUIStore((state) => state.setShowLoginDialog)
  const {
    canSendPrivateMessages,
    appKeysManagerReady,
    sessionManagerReady,
    pendingAutoRegistration,
    privateMessagingBlocked,
  } = useDevicesStore()

  // Keep device management reachable while chats are waiting for registration.
  // Rendering in place preserves the destination and recipient after setup.
  if (
    pathname === "/chats/new/devices" ||
    (publicKey && hasWriteAccess && canSendPrivateMessages && !privateMessagingBlocked)
  ) {
    return children
  }

  const needsSignIn = !publicKey || !hasWriteAccess
  const isInitializing =
    !appKeysManagerReady || !sessionManagerReady || pendingAutoRegistration
  const reloadButton = (
    <button className="btn btn-primary w-full" onClick={() => window.location.reload()}>
      Reload
    </button>
  )
  let title = "Set up chats"
  let description = "Register this device to send and receive encrypted messages."
  let action: ReactNode = <RegisterDevice />

  if (needsSignIn) {
    title = "Sign in to use chats"
    description = "Sign in or link this device to your account to get started."
    action = (
      <button
        className="btn btn-primary w-full"
        onClick={() => setShowLoginDialog(true, "signin")}
      >
        Sign in
      </button>
    )
  } else if (privateMessagingBlocked) {
    title = "Chats is open in another tab"
    description = "Close the other tab, then reload to use chats here."
    action = reloadButton
  } else if (isInitializing) {
    action = (
      <div
        role="status"
        className="flex items-center justify-center gap-2 text-sm text-base-content/70"
      >
        <span className="loading loading-spinner loading-sm" aria-hidden="true" />
        Getting chats ready…
      </div>
    )
  } else if (linkedDevice) {
    title = "Finish linking this device"
    description = "Approve this device from your other device to use chats here."
    action = reloadButton
  }

  return (
    <section className="flex flex-1 flex-col min-h-0">
      <Helmet>
        <title>Set up chats</title>
      </Helmet>
      <Header title="Chats" slideUp={false} />
      <div className="flex flex-1 flex-col items-center justify-center overflow-y-auto px-6 pt-[calc(5rem+env(safe-area-inset-top))] pb-[calc(5rem+env(safe-area-inset-bottom))] md:py-12">
        <div className="w-full max-w-sm text-center">
          <RiLockFill
            className="w-10 h-10 text-primary mx-auto mb-5"
            aria-hidden="true"
          />
          <h1 className="text-2xl font-semibold">{title}</h1>
          <p className="mt-3 mb-6 text-base-content/70">{description}</p>
          {action}
        </div>
      </div>
    </section>
  )
}
