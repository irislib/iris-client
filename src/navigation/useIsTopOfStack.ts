import {useContext} from "react"
import {RouteContext} from "./routeContexts"
import {useNavigation} from "./hooks"

/**
 * Hook to determine if current view is both visible and at top of navigation stack
 * @returns true if document is visible AND this view is the active stack card
 */
export function useIsTopOfStack(): boolean {
  const {currentPath} = useNavigation()
  const routeContext = useContext(RouteContext)

  return currentPath === (routeContext?.url || currentPath)
}
