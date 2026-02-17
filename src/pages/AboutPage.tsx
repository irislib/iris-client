import {
  RiInformationLine,
  RiMessage3Line,
  RiCodeLine,
  RiRefreshLine,
  RiUserFollowLine,
  RiFileTextLine,
  RiAppleFill,
  RiGooglePlayFill,
  RiAndroidFill,
  RiMacbookFill,
  RiArrowDownSLine,
  RiArrowUpSLine,
} from "@remixicon/react"
import RightColumn from "@/shared/components/RightColumn"
import AlgorithmicFeed from "@/shared/components/feed/AlgorithmicFeed"
import Feed from "@/shared/components/feed/Feed"
import Header from "@/shared/components/header/Header"
import Widget from "@/shared/components/ui/Widget"
import {ScrollablePageContainer} from "@/shared/components/layout/ScrollablePageContainer"
import {useState, useEffect} from "react"
import {Link} from "@/navigation"
import {openExternalLink, isTauri} from "@/utils/utils"
import {KIND_ZAP_RECEIPT} from "@/utils/constants"

export const AboutPage = () => {
  const [updateAvailable, setUpdateAvailable] = useState(false)
  const [donationsExpanded, setDonationsExpanded] = useState(false)
  const buildTime = import.meta.env.VITE_BUILD_TIME || "development"

  const formatBuildTime = (timestamp: string) => {
    if (timestamp === "development") return timestamp
    try {
      const date = new Date(timestamp)
      return new Intl.DateTimeFormat("default", {
        dateStyle: "medium",
        timeStyle: "medium",
      }).format(date)
    } catch {
      return timestamp
    }
  }

  useEffect(() => {
    // Check for service worker updates
    if ("serviceWorker" in navigator) {
      const handleControllerChange = () => setUpdateAvailable(true)
      navigator.serviceWorker.addEventListener("controllerchange", handleControllerChange)
      return () => {
        navigator.serviceWorker.removeEventListener(
          "controllerchange",
          handleControllerChange
        )
      }
    }
  }, [])

  const refreshApp = () => {
    window.location.reload()
  }

  const checkForUpdates = () => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.ready.then((registration) => {
        registration.update().catch(console.error)
      })
    }
  }

  // Check for updates when the page loads
  useEffect(() => {
    checkForUpdates()
  }, [])

  return (
    <div className="flex flex-1 overflow-hidden">
      <div className="flex flex-col flex-1 overflow-hidden">
        <Header title="About" />
        <ScrollablePageContainer>
          <div className="mx-4 md:mx-8 my-4">
            <div className="prose max-w-prose">
              <h1>About</h1>
              <p>{CONFIG.aboutText}</p>

              <h2>Getting Started</h2>
              <p>
                <a
                  href="https://soapbox.pub/blog/nostr101/"
                  onClick={(e) => {
                    e.preventDefault()
                    openExternalLink("https://soapbox.pub/blog/nostr101/")
                  }}
                  className="flex items-center gap-1 w-fit"
                >
                  <RiInformationLine className="inline" /> What is Nostr?
                </a>
              </p>
              <p>
                <a
                  href="https://following.space/"
                  onClick={(e) => {
                    e.preventDefault()
                    openExternalLink("https://following.space/")
                  }}
                  className="flex items-center gap-1 w-fit"
                >
                  <RiUserFollowLine className="inline" /> Find people to follow
                </a>
              </p>
              <p>
                <Link
                  to="/chats/1d2f13b495d7425b70298a8acd375897a632562043d461e89b63499363eaf8e7"
                  className="flex items-center gap-1 w-fit"
                >
                  <RiMessage3Line className="inline" /> Iris feedback, support and
                  discussion chat
                </Link>
              </p>

              {!isTauri() && (
                <>
                  <h2>Download</h2>
                  <p>
                    <a
                      href="https://apps.apple.com/en/app/iris-the-nostr-client/id1665849007"
                      onClick={(e) => {
                        e.preventDefault()
                        openExternalLink(
                          "https://apps.apple.com/en/app/iris-the-nostr-client/id1665849007"
                        )
                      }}
                      className="flex items-center gap-1 w-fit"
                    >
                      <RiAppleFill className="inline" /> iOS App Store
                    </a>
                  </p>
                  <p>
                    <a
                      href="https://zapstore.dev/apps/naddr1qvzqqqr7pvpzq3frhevd89d3kxt2nwxg9vpck6y4evptdq7scff6j4gx3kapltxsqqrhgmewd9exjucxe8nj5"
                      onClick={(e) => {
                        e.preventDefault()
                        openExternalLink(
                          "https://zapstore.dev/apps/naddr1qvzqqqr7pvpzq3frhevd89d3kxt2nwxg9vpck6y4evptdq7scff6j4gx3kapltxsqqrhgmewd9exjucxe8nj5"
                        )
                      }}
                      className="flex items-center gap-1 w-fit"
                    >
                      <RiAndroidFill className="inline" /> Android Zapstore
                    </a>
                  </p>
                  <p>
                    <a
                      href="https://play.google.com/store/apps/details?id=to.iris.twa&pcampaignid=web_share"
                      onClick={(e) => {
                        e.preventDefault()
                        openExternalLink(
                          "https://play.google.com/store/apps/details?id=to.iris.twa&pcampaignid=web_share"
                        )
                      }}
                      className="flex items-center gap-1 w-fit"
                    >
                      <RiGooglePlayFill className="inline" /> Google Play Store
                    </a>
                  </p>
                  <p>
                    <a
                      href="https://github.com/irislib/iris-client/releases"
                      onClick={(e) => {
                        e.preventDefault()
                        openExternalLink(
                          "https://github.com/irislib/iris-client/releases"
                        )
                      }}
                      className="flex items-center gap-1 w-fit"
                    >
                      <RiMacbookFill className="inline" /> Desktop
                    </a>
                  </p>
                </>
              )}

              <h2>Developers</h2>
              <p>
                <a
                  href={CONFIG.repository}
                  onClick={(e) => {
                    e.preventDefault()
                    openExternalLink(CONFIG.repository)
                  }}
                  className="flex items-center gap-1 w-fit"
                >
                  <RiCodeLine className="inline" /> Source code
                </a>
              </p>

              <h2>Legal</h2>
              <p>
                <Link to="/terms" className="flex items-center gap-1 w-fit">
                  <RiFileTextLine className="inline" /> Terms of Service
                </Link>
              </p>
              <p>
                <Link to="/privacy" className="flex items-center gap-1 w-fit">
                  <RiFileTextLine className="inline" /> Privacy Policy
                </Link>
              </p>

              <h2>Application</h2>
              <div className="mt-4">
                <p>
                  Version:{" "}
                  {isTauri() ? (
                    <>
                      <span className="line-through opacity-50">Web</span> /{" "}
                      <strong>Native</strong>
                    </>
                  ) : (
                    <>
                      <strong>Web</strong> /{" "}
                      <span className="line-through opacity-50">Native</span>
                    </>
                  )}
                </p>
                <p>App build time: {formatBuildTime(buildTime)}</p>
              </div>

              <div className="mt-6">
                <button
                  className={`btn btn-primary ${updateAvailable ? "animate-pulse" : ""}`}
                  onClick={refreshApp}
                >
                  <RiRefreshLine className="inline mr-1" />
                  {updateAvailable
                    ? "Update Available - Click to Refresh"
                    : "Refresh Application"}
                </button>
                <p className="text-sm mt-4">
                  Reload the application to apply any pending updates or fix issues.
                </p>
              </div>

              <h2 className="mt-8">Donations</h2>
              <div className="border border-base-content/20 rounded-lg overflow-hidden">
                <button
                  className="w-full p-4 flex items-center justify-between hover:bg-base-200/50 transition-colors"
                  onClick={() => setDonationsExpanded(!donationsExpanded)}
                >
                  <span className="font-semibold">Recent Iris donations</span>
                  {donationsExpanded ? (
                    <RiArrowUpSLine className="w-5 h-5" />
                  ) : (
                    <RiArrowDownSLine className="w-5 h-5" />
                  )}
                </button>
                {donationsExpanded && (
                  <div className="h-96 overflow-y-scroll border-t border-base-content/20">
                    <Feed
                      feedConfig={{
                        name: "Donations",
                        id: "iris-donations",
                        showEventsByUnknownUsers: true,
                        filter: {
                          kinds: [KIND_ZAP_RECEIPT],
                          "#t": ["irisdonation"],
                        },
                      }}
                      borderTopFirst={false}
                      showDisplayAsSelector={false}
                    />
                  </div>
                )}
              </div>
            </div>
          </div>
        </ScrollablePageContainer>
      </div>
      <RightColumn>
        {() => (
          <>
            <Widget title="Popular" className="h-96">
              <AlgorithmicFeed
                type="popular"
                displayOptions={{
                  small: true,
                  showDisplaySelector: false,
                }}
              />
            </Widget>
          </>
        )}
      </RightColumn>
    </div>
  )
}
