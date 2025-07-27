import {
  RiInformationLine,
  RiMessage3Line,
  RiGithubLine,
  RiRefreshLine,
  RiUserFollowLine,
  RiHeartLine,
  RiDownload2Line,
} from "@remixicon/react"
import RightColumn from "@/shared/components/RightColumn"
import PopularFeed from "@/shared/components/feed/PopularFeed"
import Header from "@/shared/components/header/Header"
import Widget from "@/shared/components/ui/Widget"
import {useState, useEffect} from "react"
import {Link} from "react-router"

export const AboutPage = () => {
  const [updateAvailable, setUpdateAvailable] = useState(false)
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
      navigator.serviceWorker.ready.then((registration) => {
        registration.addEventListener("controllerchange", () => {
          setUpdateAvailable(true)
        })
      })
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
    <div className="flex justify-center">
      <div className="flex-1">
        <section className="flex flex-col">
          <Header title="About" />
          <div className="flex flex-1 mx-4 my-4 lg:mx-8">
            <div className="prose max-w-prose">
              <h1>About</h1>
              <p>
                Iris is a social networking app built on Nostr, a decentralized protocol.
              </p>
              <p>
                <a
                  href="https://soapbox.pub/blog/nostr101/"
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1"
                >
                  <RiInformationLine className="inline" /> What is Nostr?
                </a>
              </p>
              <p>
                <Link
                  to="/chats/1d2f13b495d7425b70298a8acd375897a632562043d461e89b63499363eaf8e7"
                  className="flex items-center gap-1"
                >
                  <RiMessage3Line className="inline" /> Iris feedback, support and
                  discussion chat
                </Link>
              </p>
              <p>
                <a
                  href="https://github.com/irislib/iris-client"
                  className="flex items-center gap-1"
                >
                  <RiGithubLine className="inline" /> Source code
                </a>
              </p>
              <p>
                <a
                  href="https://following.space/"
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1"
                >
                  <RiUserFollowLine className="inline" /> Find people to follow
                </a>
              </p>
              <p>
                <a
                  href="https://github.com/irislib/iris-client/releases"
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1"
                >
                  <RiDownload2Line className="inline" /> Download Iris for desktop
                </a>
              </p>
              <p>
                <Link to="/subscribe" className="flex items-center gap-1">
                  <RiHeartLine className="inline" /> Subscribe to support Iris development
                </Link>
              </p>
              <div className="mt-4">
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
            </div>
          </div>
        </section>
      </div>
      <RightColumn>
        {() => (
          <>
            <Widget title="Popular">
              <PopularFeed />
            </Widget>
          </>
        )}
      </RightColumn>
    </div>
  )
}
