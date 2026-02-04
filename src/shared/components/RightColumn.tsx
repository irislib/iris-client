import SearchBox from "@/shared/components/ui/SearchBox.tsx"
import {ReactNode} from "react"
import {RiArrowLeftSLine, RiArrowRightSLine} from "@remixicon/react"
import {useSettingsStore} from "@/stores/settings"
import ErrorBoundary from "./ui/ErrorBoundary"
import {useIsLargeScreen} from "@/shared/hooks/useIsLargeScreen"

interface RightColumnProps {
  children: () => ReactNode
}

function RightColumn({children}: RightColumnProps) {
  const isLargeScreen = useIsLargeScreen()
  const {appearance, updateAppearance} = useSettingsStore()
  const isExpanded = appearance.showRightColumn

  const isTestEnvironment =
    typeof window !== "undefined" && window.location.href.includes("localhost:5173")

  // Don't show right column when two-column layout is enabled (singleColumnLayout is false)
  if (!appearance.singleColumnLayout) {
    return null
  }

  if (!isLargeScreen && !isTestEnvironment) {
    return null
  }

  // Collapsed state - just show toggle arrow
  if (!isExpanded) {
    return (
      <div className="hidden lg:block fixed top-3 z-50 right-4 xl:right-[calc((100vw-1280px)/2+16px)]">
        <button
          onClick={() => updateAppearance({showRightColumn: true})}
          className="p-2 bg-base-100 hover:bg-base-200 rounded-full transition-colors"
          title="Show right column"
        >
          <RiArrowLeftSLine className="w-5 h-5" />
        </button>
      </div>
    )
  }

  return (
    <ErrorBoundary>
      <div className="px-4 py-4 h-full overflow-y-auto scrollbar-hide flex flex-col gap-4 w-80 flex-shrink-0 hidden lg:flex border-l border-custom">
        <div className="flex items-center gap-2">
          <div className="flex-1">
            <SearchBox searchNotes={true} />
          </div>
          <button
            onClick={() => updateAppearance({showRightColumn: false})}
            className="p-2 bg-base-100 hover:bg-base-200 rounded-full transition-colors flex-shrink-0"
            title="Hide right column"
          >
            <RiArrowRightSLine className="w-5 h-5" />
          </button>
        </div>
        {children()}
      </div>
    </ErrorBoundary>
  )
}

export default RightColumn
