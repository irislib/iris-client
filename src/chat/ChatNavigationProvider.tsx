import {useState, useEffect, useRef, useCallback, type ReactNode} from "react"
import {NavigationContextType, StackItem, NavigateOptions} from "@/navigation/types"
import {matchPath} from "@/navigation/utils"
import {NavigationContext} from "@/navigation/contexts"
import {chatRoutes} from "./routes"

const MAX_STACK_SIZE = 5

type NavigationState = {
  stack: StackItem[]
  currentIndex: number
}

// Get route params for chat routes
function getChatRouteParams(pathname: string): Record<string, string> {
  for (const route of chatRoutes) {
    const match = matchPath(pathname, route.path)
    if (match) {
      return match.params
    }
  }
  return {}
}

export const ChatNavigationProvider = ({children}: {children: ReactNode}) => {
  const [navState, setNavState] = useState<NavigationState>({
    stack: [],
    currentIndex: -1,
  })
  const stackIndexRef = useRef(0)
  const currentUrlRef = useRef(window.location.pathname + window.location.search)

  // Initialize with current URL
  useEffect(() => {
    const initialPath = window.location.pathname + window.location.search
    const existingState = window.history.state

    if (existingState && typeof existingState.index === "number") {
      const initialItem: StackItem = {
        index: existingState.index,
        url: initialPath,
        component: null,
        state: existingState.state,
      }
      stackIndexRef.current = existingState.index
      setNavState({
        stack: [initialItem],
        currentIndex: 0,
      })
    } else {
      const initialItem: StackItem = {
        index: 0,
        url: initialPath,
        component: null,
      }
      setNavState({
        stack: [initialItem],
        currentIndex: 0,
      })
      window.history.replaceState({index: 0, url: initialPath}, "", initialPath)
    }
  }, [])

  const shouldAlwaysKeep = (url: string): boolean => {
    for (const route of chatRoutes) {
      const match = matchPath(url, route.path)
      if (match && route.alwaysKeep) {
        return true
      }
    }
    return false
  }

  // Handle browser back/forward
  useEffect(() => {
    const handlePopState = (event: PopStateEvent) => {
      const newUrl = window.location.pathname + window.location.search
      const state = event.state

      setNavState((prevState) => {
        currentUrlRef.current = newUrl

        if (!state || typeof state.index !== "number") {
          const existingIndex = prevState.stack.findIndex(
            (item) => item.url === newUrl && !item.state
          )

          if (existingIndex !== -1) {
            return {
              ...prevState,
              currentIndex: existingIndex,
            }
          }

          return {
            stack: [
              {
                index: -1,
                url: newUrl,
                component: null,
              },
            ],
            currentIndex: 0,
          }
        }

        const position = prevState.stack.findIndex((item) => item.index === state.index)

        if (position !== -1) {
          return {
            ...prevState,
            currentIndex: position,
          }
        }

        if (!state.state) {
          const urlPosition = prevState.stack.findIndex(
            (item) => item.url === newUrl && !item.state
          )

          if (urlPosition !== -1) {
            const updatedStack = [...prevState.stack]
            updatedStack[urlPosition] = {
              ...updatedStack[urlPosition],
              index: state.index,
            }
            return {
              stack: updatedStack,
              currentIndex: urlPosition,
            }
          }
        }

        const newItem: StackItem = {
          index: state.index,
          url: newUrl,
          component: null,
          state: state.state,
        }

        let newStack = [...prevState.stack, newItem]
        newStack.sort((a, b) => a.index - b.index)

        const newPosition = newStack.findIndex((item) => item.index === state.index)

        if (newStack.length > MAX_STACK_SIZE) {
          const itemsToRemove = newStack.length - MAX_STACK_SIZE
          let removed = 0

          newStack = newStack.filter((item, index) => {
            if (index === newPosition) return true
            if (shouldAlwaysKeep(item.url)) return true
            if (removed < itemsToRemove && index < newPosition) {
              removed++
              return false
            }
            return true
          })

          const finalPosition = newStack.findIndex((item) => item.index === state.index)
          return {
            stack: newStack,
            currentIndex: finalPosition,
          }
        }

        return {
          stack: newStack,
          currentIndex: newPosition,
        }
      })
    }

    window.addEventListener("popstate", handlePopState)
    return () => window.removeEventListener("popstate", handlePopState)
  }, [])

  const navigate = useCallback((path: string, options?: NavigateOptions) => {
    if (options?.replace) {
      setNavState((prevState) => {
        const newStack = [...prevState.stack]
        const {currentIndex} = prevState

        if (currentIndex >= 0 && currentIndex < newStack.length) {
          newStack[currentIndex] = {
            ...newStack[currentIndex],
            url: path,
            component: null,
            state: options.state,
          }
        }

        window.history.replaceState(
          {index: newStack[currentIndex]?.index || 0, url: path, state: options.state},
          "",
          path
        )

        return {...prevState, stack: newStack}
      })
      return
    }

    setNavState((prevState) => {
      const updatedStack = [...prevState.stack]

      if (options?.state) {
        const newIndex = ++stackIndexRef.current
        const newStack = updatedStack

        const newItem: StackItem = {
          index: newIndex,
          url: path,
          component: null,
          state: options.state,
        }

        newStack.splice(prevState.currentIndex + 1, 0, newItem)

        window.history.pushState(
          {index: newIndex, url: path, state: options.state},
          "",
          path
        )
        currentUrlRef.current = path

        return {
          stack: newStack,
          currentIndex: prevState.currentIndex + 1,
        }
      }

      const existingIndex = updatedStack.findIndex(
        (item) => item.url === path && !item.state
      )

      if (existingIndex !== -1) {
        const existingItem = updatedStack[existingIndex]
        window.history.pushState({index: existingItem.index, url: path}, "", path)
        currentUrlRef.current = path

        return {
          stack: updatedStack,
          currentIndex: existingIndex,
        }
      }

      const newIndex = ++stackIndexRef.current
      let newStack = updatedStack.slice(0, prevState.currentIndex + 1)

      const newItem: StackItem = {
        index: newIndex,
        url: path,
        component: null,
      }
      newStack.push(newItem)

      if (newStack.length > MAX_STACK_SIZE) {
        const itemsToRemove = newStack.length - MAX_STACK_SIZE
        let removed = 0

        newStack = newStack.filter((item, index) => {
          if (index === newStack.length - 1) return true
          if (shouldAlwaysKeep(item.url)) return true
          if (removed < itemsToRemove) {
            removed++
            return false
          }
          return true
        })
      }

      window.history.pushState({index: newIndex, url: path}, "", path)
      currentUrlRef.current = path

      return {
        stack: newStack,
        currentIndex: newStack.length - 1,
      }
    })
  }, [])

  const replace = useCallback((path: string) => {
    setNavState((prevState) => {
      const newStack = [...prevState.stack]
      const {currentIndex} = prevState

      if (currentIndex >= 0 && currentIndex < newStack.length) {
        newStack[currentIndex] = {
          ...newStack[currentIndex],
          url: path,
          component: null,
        }

        window.history.replaceState(
          {index: newStack[currentIndex].index, url: path},
          "",
          path
        )
        currentUrlRef.current = path
      }

      return {...prevState, stack: newStack}
    })
  }, [])

  const goBack = useCallback(() => {
    if (navState.currentIndex > 0) {
      window.history.back()
    } else {
      navigate("/")
    }
  }, [navState.currentIndex, navigate])

  const goForward = useCallback(() => {
    if (navState.currentIndex < navState.stack.length - 1) {
      window.history.forward()
    }
  }, [navState.currentIndex, navState.stack.length])

  const clearStack = useCallback(() => {
    setNavState((prevState) => ({
      stack: [prevState.stack[0] || {index: 0, url: "/", component: null}],
      currentIndex: 0,
    }))
    stackIndexRef.current = 0
  }, [])

  const {stack, currentIndex} = navState
  const currentPath = stack[currentIndex]?.url || "/"
  const currentState = stack[currentIndex]?.state
  const canGoBack = currentIndex > 0
  const canGoForward = currentIndex < stack.length - 1
  const currentParams = getChatRouteParams(currentPath)

  const value: NavigationContextType = {
    currentPath,
    currentParams,
    currentState,
    stack,
    currentIndex,
    navigate,
    goBack,
    goForward,
    canGoBack,
    canGoForward,
    replace,
    clearStack,
  }

  return <NavigationContext.Provider value={value}>{children}</NavigationContext.Provider>
}
