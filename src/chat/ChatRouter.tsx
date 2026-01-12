import {Suspense} from "react"
import {useNavigation} from "@/navigation/hooks"
import {chatRoutes} from "./routes"
import {matchPath} from "@/navigation/utils"
import {LoadingFallback} from "@/shared/components/LoadingFallback"
import {RouteProvider} from "@/navigation/RouteContext"
import {RouteBaseContext} from "@/navigation/contexts"
import ErrorBoundary from "@/shared/components/ui/ErrorBoundary"

export const ChatRouter = () => {
  const {stack, currentIndex} = useNavigation()

  return (
    <>
      {stack.map((item, index) => {
        let matchedRoute = null
        let params: Record<string, string> = {}
        let basePath = ""

        for (const route of chatRoutes) {
          const match = matchPath(item.url, route.path)
          if (match) {
            matchedRoute = route
            params = match.params
            if (route.path.endsWith("/*")) {
              basePath = route.path.slice(0, -2)
            }
            break
          }
        }

        const RouteComponent = matchedRoute?.component
        const routeKey = item.state ? `stack-${item.index}` : `url-${item.url}`

        return (
          <div
            key={routeKey}
            style={{
              display: index === currentIndex ? "flex" : "none",
              flexDirection: "column",
              flex: 1,
              minHeight: 0,
            }}
          >
            <RouteProvider params={params} url={item.url}>
              <RouteBaseContext.Provider value={basePath}>
                <ErrorBoundary>
                  <Suspense fallback={<LoadingFallback />}>
                    {RouteComponent ? (
                      <RouteComponent {...params} />
                    ) : (
                      <div className="flex items-center justify-center h-full">
                        <p className="text-base-content/60">Page not found</p>
                      </div>
                    )}
                  </Suspense>
                </ErrorBoundary>
              </RouteBaseContext.Provider>
            </RouteProvider>
          </div>
        )
      })}
    </>
  )
}
