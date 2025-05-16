import {SearchResult} from "@/utils/profileSearch"
import {persist} from "zustand/middleware"
import {create} from "zustand"

export type CustomSearchResult = SearchResult & {
  query?: string
  pubKey: string
}

interface SearchState {
  recentSearches: CustomSearchResult[]

  setRecentSearches: (searches: CustomSearchResult[]) => void
}

export const useSearchStore = create<SearchState>()(
  persist(
    (set) => {
      const initialState = {
        recentSearches: [] as CustomSearchResult[],
      }

      const actions = {
        setRecentSearches: (recentSearches: CustomSearchResult[]) =>
          set({recentSearches}),
      }

      return {
        ...initialState,
        ...actions,
      }
    },
    {
      name: "search-storage",
    }
  )
)

export const useRecentSearches = () => useSearchStore((state) => state.recentSearches)
