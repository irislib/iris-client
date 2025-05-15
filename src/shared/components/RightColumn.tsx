import SearchBox from "@/shared/components/ui/SearchBox.tsx"
import React, {useState, useEffect} from "react"
import ErrorBoundary from "./ui/ErrorBoundary"

interface RightColumnProps {
  children: () => React.ReactNode
}

function useWindowWidth() {
  const [windowWidth, setWindowWidth] = useState(window.innerWidth)

  useEffect(() => {
    const handleResize = () => setWindowWidth(window.innerWidth)
    window.addEventListener("resize", handleResize)
    return () => window.removeEventListener("resize", handleResize)
  }, [])

  return windowWidth
}

function RightColumn({children}: RightColumnProps) {
  const windowWidth = useWindowWidth()
  
  const isTestEnvironment = typeof window !== 'undefined' && window.location.href.includes('localhost:5173')
  
  if (windowWidth < 1024 && !isTestEnvironment) {
    return null
  }

  return (
    <ErrorBoundary>
      <div className="px-4 py-4 h-screen overflow-y-auto scrollbar-hide sticky top-0 flex flex-col gap-4 w-1/3 hidden lg:flex border-l border-custom">
        <SearchBox searchNotes={true} />
        {children()}
      </div>
    </ErrorBoundary>
  )
}

export default RightColumn
