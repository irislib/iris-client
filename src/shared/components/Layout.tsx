import {Outlet, useLocation, useNavigate, useNavigationType} from "react-router"
import NoteCreator from "@/shared/components/create/NoteCreator.tsx"
import LoginDialog from "@/shared/components/user/LoginDialog"
import {useLocalState} from "irisdb-hooks/src/useLocalState"
import NavSideBar from "@/shared/components/nav/NavSideBar"
import {useInviteFromUrl} from "../hooks/useInviteFromUrl"
import {clearNotifications} from "@/utils/notifications"
import {socialGraphLoaded} from "@/utils/socialGraph"
import Modal from "@/shared/components/ui/Modal.tsx"
import Footer from "@/shared/components/Footer.tsx"
import {useSettingsStore} from "@/stores/settings"
import {useUserStore} from "@/stores/user"
import ErrorBoundary from "./ui/ErrorBoundary"
import {trackEvent} from "@/utils/IrisAPI"
import {Helmet} from "react-helmet"
import {useEffect} from "react"

const openedAt = Math.floor(Date.now() / 1000)

interface ServiceWorkerMessage {
  type: "NAVIGATE_REACT_ROUTER"
  url: string
}

const Layout = () => {
  const [newPostOpen, setNewPostOpen] = useLocalState("home/newPostOpen", false)
  const {privacy} = useSettingsStore()
  const [goToNotifications] = useLocalState("goToNotifications", 0)
  const [showLoginDialog, setShowLoginDialog] = useLocalState(
    "home/showLoginDialog",
    false
  )
  const navigate = useNavigate()
  const navigationType = useNavigationType()
  const location = useLocation()

  useInviteFromUrl()

  socialGraphLoaded.then() // just make sure we start loading social the graph

  useEffect(() => {
    if (goToNotifications > openedAt) {
      navigate("/notifications")
    }
  }, [navigate, goToNotifications])

  useEffect(() => {
    if (navigationType === "PUSH") {
      window.scrollTo(0, 0)
    }

    const isMessagesRoute = location.pathname.startsWith("/chats/")
    const isSearchRoute = location.pathname.startsWith("/search/")
    if (
      CONFIG.features.analytics &&
      privacy.enableAnalytics &&
      !isMessagesRoute &&
      !isSearchRoute
    ) {
      trackEvent("pageview")
    }
  }, [location, navigationType])

  useEffect(() => {
    const handleServiceWorkerMessage = (event: MessageEvent<ServiceWorkerMessage>) => {
      if (event.data?.type === "NAVIGATE_REACT_ROUTER") {
        const url = new URL(event.data.url)
        if (url.pathname.match(/^\/chats\/[^/]+$/)) {
          const chatId = url.pathname.split("/").pop()
          navigate("/chats/chat", {state: {id: chatId}})
        } else {
          navigate(url.pathname + url.search + url.hash)
        }
      }
    }

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.addEventListener("message", handleServiceWorkerMessage)
      return () => {
        navigator.serviceWorker.removeEventListener("message", handleServiceWorkerMessage)
      }
    }
  }, [navigate])

  useEffect(() => {
    // clear potential push notifications when the app is opened
    clearNotifications()

    const handleVisibilityChange = async () => {
      if (document.visibilityState === "visible") {
        await clearNotifications()
      }
    }

    const handleFocus = async () => {
      await clearNotifications()
    }

    document.addEventListener("visibilitychange", handleVisibilityChange)
    window.addEventListener("focus", handleFocus)

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange)
      window.removeEventListener("focus", handleFocus)
    }
  }, [])

  return (
    <div className="relative flex flex-col w-full max-w-screen-xl min-h-screen overscroll-none">
      <div
        className="flex relative min-h-screen flex-1 overscroll-none"
        id="main-content"
      >
        <NavSideBar />
        <div className="relative flex-1 min-h-screen py-16 md:py-0 overscroll-none mb-[env(safe-area-inset-bottom)]">
          <ErrorBoundary>
            <Outlet />
            {useUserStore.getState().cashuEnabled && (
              <iframe
                id="cashu-wallet"
                title="Background Cashu Wallet"
                src="/cashu"
                className="fixed top-0 left-0 w-0 h-0 border-none"
                style={{zIndex: -1}}
                referrerPolicy="no-referrer"
              />
            )}
          </ErrorBoundary>
        </div>
      </div>
      <ErrorBoundary>
        {newPostOpen && (
          <Modal onClose={() => setNewPostOpen(!newPostOpen)} hasBackground={false}>
            <div
              className="w-full max-w-prose rounded-2xl bg-base-100"
              onClick={(e) => e.stopPropagation()}
            >
              <NoteCreator handleClose={() => setNewPostOpen(!newPostOpen)} />
            </div>
          </Modal>
        )}
        {showLoginDialog && (
          <Modal onClose={() => setShowLoginDialog(false)}>
            <LoginDialog />
          </Modal>
        )}
      </ErrorBoundary>
      <Footer /> {/* Add Footer component here */}
      <Helmet titleTemplate={`%s / ${CONFIG.appName}`} defaultTitle={CONFIG.appName}>
        <title>{CONFIG.appName}</title>
      </Helmet>
    </div>
  )
}

export default Layout
