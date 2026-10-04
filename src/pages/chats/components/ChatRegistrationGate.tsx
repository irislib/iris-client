import {type ReactNode} from "react"
import {RiLockFill} from "@remixicon/react"
import {Helmet} from "react-helmet"
import {nip19} from "nostr-tools"
import {useLocation} from "@/navigation"
import Header from "@/shared/components/header/Header"
import {useDevicesStore} from "@/stores/devices"
import {useUserStore} from "@/stores/user"
import {hasWriteAccessForState} from "@/utils/auth"

export default function ChatRegistrationGate({children}: {children: ReactNode}) {
  const {pathname, state} = useLocation()
  const publicKey = useUserStore((state) => state.publicKey)
  const hasWriteAccess = useUserStore(hasWriteAccessForState)
  const linkedDevice = useUserStore((state) => state.linkedDevice)
  const {
    canSendPrivateMessages,
    appKeysManagerReady,
    sessionManagerReady,
    privateMessagingBlocked,
  } = useDevicesStore()

  // Existing registered devices retain their chats and device management.
  if (publicKey && hasWriteAccess && canSendPrivateMessages && !privateMessagingBlocked) {
    return children
  }

  const needsSignIn = !publicKey || !hasWriteAccess
  const isInitializing = !appKeysManagerReady || !sessionManagerReady
  const recipient = pathname === "/chats/chat" ? state?.id : undefined
  const chatUrl =
    typeof recipient === "string" && /^[0-9a-f]{64}$/i.test(recipient)
      ? `https://chat.iris.to/#/${nip19.npubEncode(recipient)}`
      : "https://chat.iris.to/"
  const reloadButton = (
    <button className="btn btn-primary w-full" onClick={() => window.location.reload()}>
      Reload
    </button>
  )
  let title = "Chat on Iris Chat"
  let description = "Open Iris Chat for private messages and group conversations."
  let action: ReactNode = (
    <a className="btn btn-primary w-full" href={chatUrl}>
      Open Iris Chat
    </a>
  )

  if (!needsSignIn && privateMessagingBlocked) {
    title = "Chats is open in another tab"
    description = "Close the other tab, then reload to use chats here."
    action = reloadButton
  } else if (!needsSignIn && isInitializing) {
    title = "Chats"
    description = ""
    action = (
      <div
        role="status"
        className="flex items-center justify-center gap-2 text-sm text-base-content/70"
      >
        <span className="loading loading-spinner loading-sm" aria-hidden="true" />
        Getting chats ready…
      </div>
    )
  } else if (!needsSignIn && linkedDevice) {
    title = "Finish linking this device"
    description = "Approve this device from your other device to use chats here."
    action = reloadButton
  }

  return (
    <section className="flex flex-1 flex-col min-h-0">
      <Helmet>
        <title>{title}</title>
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
