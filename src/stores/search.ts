import {SearchResult} from "@/utils/profileSearch"
import {persist} from "zustand/middleware"
import {create} from "zustand"

export type CustomSearchResult = SearchResult & {
  query?: string
  pubKey: string
}

import type {SearchModel} from "@/lib/post-search/scorer"

interface SearchState {
  aiSearch: boolean
  searchModel: SearchModel
  ollamaModel: string
  setAiSearch: (enabled: boolean) => void
  setSearchModel: (model: SearchModel) => void
  setOllamaModel: (model: string) => void
  recentSearches: CustomSearchResult[]
  searchQuery: string
  showEventsByUnknownUsers: boolean
  selectedRelayUrl: string

  setRecentSearches: (searches: CustomSearchResult[]) => void
  setSearchQuery: (query: string) => void
  setShowEventsByUnknownUsers: (show: boolean) => void
  setSelectedRelayUrl: (url: string) => void
}

export const useSearchStore = create<SearchState>()(
  persist(
    (set) => {
      const initialState = {
        recentSearches: [] as CustomSearchResult[],
        searchQuery: "",
        aiSearch: true,
        searchModel: "auto" as SearchModel,
        ollamaModel: "gemma3:1b",
        showEventsByUnknownUsers: false,
        selectedRelayUrl: "",
      }

      const actions = {
        setAiSearch: (aiSearch: boolean) => set({aiSearch}),
        setSearchModel: (searchModel: SearchModel) => set({searchModel}),
        setOllamaModel: (ollamaModel: string) => set({ollamaModel}),
        setRecentSearches: (recentSearches: CustomSearchResult[]) =>
          set({recentSearches}),
        setSearchQuery: (searchQuery: string) => set({searchQuery}),
        setShowEventsByUnknownUsers: (showEventsByUnknownUsers: boolean) =>
          set({showEventsByUnknownUsers}),
        setSelectedRelayUrl: (selectedRelayUrl: string) => set({selectedRelayUrl}),
      }

      return {
        ...initialState,
        ...actions,
      }
    },
    {
      name: "search-storage",
      version: 1,
      migrate: (persisted) => {
        const state = persisted as Partial<SearchState>
        // Earlier versions persisted MiniLM even when no model had been chosen.
        return {
          ...state,
          searchModel:
            state?.searchModel === "minilm" ? "auto" : (state?.searchModel ?? "auto"),
        }
      },
    }
  )
)
