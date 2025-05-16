import {persist} from "zustand/middleware"
import {create} from "zustand"

interface FeedState {
  activeHomeTab: string
  displayCount: number
  feedDisplayAs: "list" | "grid"

  setActiveHomeTab: (tab: string) => void
  setDisplayCount: (count: number) => void
  incrementDisplayCount: (increment: number) => void
  setFeedDisplayAs: (displayAs: "list" | "grid") => void
}

export const useFeedStore = create<FeedState>()(
  persist(
    (set, get) => {
      const initialState = {
        activeHomeTab: "unseen",
        displayCount: 20,
        feedDisplayAs: "list" as const,
      }

      const actions = {
        setActiveHomeTab: (activeHomeTab: string) => set({activeHomeTab}),
        setDisplayCount: (displayCount: number) => set({displayCount}),
        incrementDisplayCount: (increment: number) =>
          set({displayCount: get().displayCount + increment}),
        setFeedDisplayAs: (feedDisplayAs: "list" | "grid") => set({feedDisplayAs}),
      }

      return {
        ...initialState,
        ...actions,
      }
    },
    {
      name: "feed-storage",
    }
  )
)

export const useActiveHomeTab = () => useFeedStore((state) => state.activeHomeTab)
export const useDisplayCount = () => useFeedStore((state) => state.displayCount)
export const useFeedDisplayAs = () => useFeedStore((state) => state.feedDisplayAs)
