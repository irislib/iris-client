import {useLocation, useNavigate} from "@/navigation"
import {getCurrentRouteInfo} from "@/navigation/utils"
import NoteCreator from "@/shared/components/create/NoteCreator.tsx"
import LoginDialog from "@/shared/components/user/LoginDialog"
import NavSideBar from "@/shared/components/nav/NavSideBar"
import {clearNotifications} from "@/utils/notifications"
import {useFollowsFromGraph} from "@/utils/socialGraph"
import Modal from "@/shared/components/ui/Modal.tsx"
import Footer from "@/shared/components/Footer.tsx"
import {useSettingsStore} from "@/stores/settings"
import ErrorBoundary from "./ui/ErrorBoundary"
import {useWalletProviderStore} from "@/stores/walletProvider"
import {useUIStore} from "@/stores/ui"
import {Helmet} from "react-helmet"
import {useEffect, ReactNode, useRef, useMemo, useState} from "react"
import {useIsLargeScreen} from "@/shared/hooks/useIsLargeScreen"
import {useIsTwoColumnLayout} from "@/shared/hooks/useIsTwoColumnLayout"
import {useUniversalPaste} from "@/shared/hooks/useUniversalPaste"
import HomeFeed from "@/pages/home/feed/components/HomeFeed"
import UnifiedSearchContent from "@/shared/components/search/UnifiedSearchContent"
import {ScrollProvider} from "@/contexts/ScrollContext"
import Header from "@/shared/components/header/Header"
import {usePublicKey} from "@/stores/user"
import {
  useFeedStore,
  useFeedConfigs,
  useEnabledFeedIds,
  type FeedConfig,
} from "@/stores/feed"
import Toast from "@/shared/components/ui/Toast"
import TermsOfService from "@/shared/components/TermsOfService"
import {isTauri} from "@/utils/utils"

const openedAt = Math.floor(Date.now() / 1000)

interface ServiceWorkerMessage {
  type: "NAVIGATE_REACT_ROUTER"
  url: string
}

const Layout = ({children}: {children: ReactNode}) => {
  const middleColumnRef = useRef<HTMLDivElement>(null)
  const newPostOpen = useUIStore((state) => state.newPostOpen)
  const setNewPostOpen = useUIStore((state) => state.setNewPostOpen)
  const navItemClicked = useUIStore((state) => state.navItemClicked)
  const {appearance} = useSettingsStore()
  const goToNotifications = useUIStore((state) => state.goToNotifications)
  const showLoginDialog = useUIStore((state) => state.showLoginDialog)
  const setShowLoginDialog = useUIStore((state) => state.setShowLoginDialog)
  const initializeProviders = useWalletProviderStore((state) => state.initializeProviders)
  const navigate = useNavigate()
  const location = useLocation()
  const isLargeScreen = useIsLargeScreen()
  const isTwoColumnLayout = useIsTwoColumnLayout()

  // Universal paste handler for nostr identifiers
  useUniversalPaste()

  // Track middle column content - default to HomeFeed, and remember last search route
  const [middleColumnContent, setMiddleColumnContent] = useState<"home" | "search">(
    "home"
  )
  const [lastSearchRoute, setLastSearchRoute] = useState("/u")

  // Feed header logic for two-column layout
  const myPubKey = usePublicKey()
  // Use reactive hook - updates when graph loads
  const follows = useFollowsFromGraph(myPubKey, true)
  const {activeFeed, getAllFeedConfigs, loadFeedConfig} = useFeedStore()
  const enabledFeedIds = useEnabledFeedIds()
  const feedConfigs = useFeedConfigs()

  const allFeeds = useMemo(() => {
    return getAllFeedConfigs()
  }, [feedConfigs, enabledFeedIds, getAllFeedConfigs])

  const feeds = useMemo(() => {
    const feedsMap = new Map(allFeeds.map((feed) => [feed.id, feed]))
    return enabledFeedIds
      .map((id) => feedsMap.get(id))
      .filter((feed): feed is FeedConfig => feed !== undefined)
  }, [allFeeds, enabledFeedIds])

  const activeFeedItem = useMemo(
    () => feeds.find((f) => f.id === activeFeed) || feeds[0] || null,
    [activeFeed, feeds]
  )

  const activeFeedConfig = useMemo(
    () => loadFeedConfig(activeFeed),
    [loadFeedConfig, activeFeed, feedConfigs]
  )

  const feedName =
    follows.length <= 1
      ? "Home"
      : activeFeedConfig?.customName || activeFeedItem?.name || "Following"

  const getMiddleColumnTitle = () => {
    if (middleColumnContent === "home") return feedName

    // Use the last search route for the title when showing search content
    if (lastSearchRoute.startsWith("/map")) return "Map"
    if (lastSearchRoute.startsWith("/relay")) return "Relay"
    if (lastSearchRoute.startsWith("/u")) return "People"
    if (lastSearchRoute.startsWith("/search")) return "Search"
    if (lastSearchRoute.startsWith("/m")) return "Market"

    return "Search"
  }

  const middleColumnTitle = getMiddleColumnTitle()

  const shouldShowMainFeed =
    isTwoColumnLayout &&
    !location.pathname.startsWith("/settings") &&
    !location.pathname.startsWith("/chats")

  // Social graph loading is now non-blocking and reactive via useFollowsFromGraph

  // ToS state for Tauri apps
  const {legal, updateLegal} = useSettingsStore()
  const [showToS, setShowToS] = useState(false)

  // Check if we need to show ToS on first launch for Tauri apps
  useEffect(() => {
    if (isTauri() && !legal.tosAccepted) {
      setShowToS(true)
    }
  }, [legal.tosAccepted])

  const handleToSAccept = () => {
    updateLegal({tosAccepted: true, tosAcceptedVersion: 1})
    setShowToS(false)
  }

  // Initialize wallet providers on app startup
  useEffect(() => {
    initializeProviders()
  }, [initializeProviders])

  // Handle nav item clicks for middle column content
  useEffect(() => {
    if (navItemClicked.signal === 0 || !shouldShowMainFeed) return

    if (navItemClicked.path === "/") {
      setMiddleColumnContent("home")
      if (middleColumnRef.current) {
        middleColumnRef.current.scrollTo({top: 0, behavior: "instant"})
      }
    } else if (
      navItemClicked.path === "/u" ||
      navItemClicked.path === "/search" ||
      navItemClicked.path === "/m" ||
      navItemClicked.path === "/map" ||
      navItemClicked.path === "/relay"
    ) {
      // Set the appropriate search route based on the clicked path
      if (navItemClicked.path === "/map") {
        setLastSearchRoute("/map")
      } else if (navItemClicked.path === "/relay") {
        setLastSearchRoute("/relay")
      } else if (navItemClicked.path === "/u") {
        setLastSearchRoute("/u")
      } else if (navItemClicked.path === "/search") {
        setLastSearchRoute("/search")
      } else if (navItemClicked.path === "/m") {
        setLastSearchRoute("/m")
      }

      setMiddleColumnContent("search")
      if (middleColumnRef.current) {
        middleColumnRef.current.scrollTo({top: 0, behavior: "instant"})
      }
    }
  }, [navItemClicked, shouldShowMainFeed])

  // Set middle column content based on current route when in two-column layout
  // Only change on root route changes, not when navigating within a search section
  useEffect(() => {
    if (!shouldShowMainFeed) return

    const routeInfo = getCurrentRouteInfo(location.pathname)

    if (routeInfo.type === "home") {
      setMiddleColumnContent("home")
    } else if (routeInfo.baseRoute) {
      // This is a search route, update both content and last route
      setLastSearchRoute(routeInfo.baseRoute)
      setMiddleColumnContent("search")
    }
    // If not a recognized route, keep the current middle column content
  }, [location.pathname, shouldShowMainFeed])

  useEffect(() => {
    if (goToNotifications > openedAt) {
      navigate("/notifications")
    }
  }, [navigate, goToNotifications])

  // Handle nav item clicks - no longer needed for scroll since each component manages its own
  // Keep this for potential future use with navItemClicked signal

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
    <div
      className={`relative flex flex-col w-full h-screen overflow-hidden ${appearance.limitedMaxWidth ? "max-w-screen-2xl mx-auto" : ""}`}
    >
      <div
        className="flex relative flex-1 overflow-hidden min-w-0 w-full"
        id="main-content"
      >
        <NavSideBar />
        {!appearance.singleColumnLayout && isLargeScreen && (
          <div
            className={`flex-1 min-w-0 border-r border-base-300 flex flex-col ${
              shouldShowMainFeed ? "hidden lg:flex" : "hidden"
            }`}
          >
            <Header showBack={false} showNotifications={true}>
              <span className="md:px-3 md:py-2">{middleColumnTitle}</span>
            </Header>
            <div
              ref={middleColumnRef}
              className="flex-1 overflow-y-scroll overflow-x-hidden scrollbar-hide"
              data-main-scroll-container="middle-column"
              data-header-scroll-target
            >
              {middleColumnContent === "home" ? (
                <ScrollProvider scrollContainerRef={middleColumnRef}>
                  <HomeFeed />
                </ScrollProvider>
              ) : (
                <UnifiedSearchContent searchRoute={lastSearchRoute} />
              )}
            </div>
          </div>
        )}
        <div className="flex-1 flex flex-col overflow-hidden min-w-0">{children}</div>
      </div>
      <ErrorBoundary>
        {newPostOpen && (
          <Modal onClose={() => setNewPostOpen(false)} hasBackground={false}>
            <div
              className="w-[600px] max-w-[90vw] rounded-2xl bg-base-100"
              onClick={(e) => e.stopPropagation()}
            >
              <NoteCreator handleClose={() => setNewPostOpen(false)} />
            </div>
          </Modal>
        )}
        {showLoginDialog && (
          <Modal onClose={() => setShowLoginDialog(false)}>
            <div className="flex items-center justify-center h-full md:h-auto p-4">
              <LoginDialog />
            </div>
          </Modal>
        )}
      </ErrorBoundary>
      <Footer />
      <Toast />
      {showToS && <TermsOfService onAccept={handleToSAccept} />}
      <Helmet titleTemplate={`%s / ${CONFIG.appName}`} defaultTitle={CONFIG.appName}>
        <title>{CONFIG.appName}</title>
      </Helmet>
    </div>
  )
}

export default Layout
