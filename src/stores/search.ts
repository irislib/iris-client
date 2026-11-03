import {SearchResult} from "@/utils/profileSearch"
import {persist} from "zustand/middleware"
import {create} from "zustand"
import {useMemo} from "react"

export type CustomSearchResult = SearchResult & {
  query?: string
  pubKey: string
}

import type {SearchModel} from "@/lib/post-search/scorer"

import type {PostSearchSort} from "@/types/feed"

type PostType = "all" | "originals" | "replies"

interface SearchState {
  postSort: PostSearchSort
  postType: PostType
  mediaOnly: boolean
  setPostSort: (sort: PostSearchSort) => void
  setPostType: (type: PostType) => void
  setMediaOnly: (enabled: boolean) => void
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
        postSort: "relevance" as PostSearchSort,
        postType: "all" as PostType,
        mediaOnly: false,
        recentSearches: [] as CustomSearchResult[],
        searchQuery: "",
        aiSearch: true,
        searchModel: "auto" as SearchModel,
        ollamaModel: "gemma3:1b",
        showEventsByUnknownUsers: false,
        selectedRelayUrl: "",
      }

      const actions = {
        setPostSort: (postSort: PostSearchSort) => set({postSort}),
        setPostType: (postType: PostType) => set({postType}),
        setMediaOnly: (mediaOnly: boolean) => set({mediaOnly}),
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

export function usePostSearchSettings(enabled: boolean) {
  const model = useSearchStore((state) => state.searchModel)
  const ollamaModel = useSearchStore((state) => state.ollamaModel)
  return useMemo(
    () => (enabled ? {model, ollamaModel} : undefined),
    [enabled, model, ollamaModel]
  )
}
