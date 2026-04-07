import {useCallback, useEffect, useReducer} from "react"

import type {CustomSearchResult} from "@/stores/search"

export type StableSearchResultsState = {
  activeQuery: string
  visibleResults: CustomSearchResult[]
  pendingResults: CustomSearchResult[] | null
}

type StableSearchResultsAction =
  | {
      type: "sync"
      query: string
      liveResults: CustomSearchResult[]
    }
  | {type: "applyPending"}

export const initialStableSearchResultsState: StableSearchResultsState = {
  activeQuery: "",
  visibleResults: [],
  pendingResults: null,
}

export function stableSearchResultsEqual(
  left: CustomSearchResult[],
  right: CustomSearchResult[]
): boolean {
  if (left.length !== right.length) {
    return false
  }

  return left.every((result, index) => {
    const candidate = right[index]
    return (
      result.pubKey === candidate?.pubKey &&
      result.name === candidate?.name &&
      result.nip05 === candidate?.nip05 &&
      result.picture === candidate?.picture &&
      result.created_at === candidate?.created_at
    )
  })
}

export function stableSearchResultsReducer(
  state: StableSearchResultsState,
  action: StableSearchResultsAction
): StableSearchResultsState {
  if (action.type === "applyPending") {
    if (!state.pendingResults) {
      return state
    }

    return {
      ...state,
      visibleResults: state.pendingResults,
      pendingResults: null,
    }
  }

  const query = action.query.trim()
  if (!query) {
    return initialStableSearchResultsState
  }

  if (query !== state.activeQuery) {
    return {
      activeQuery: query,
      visibleResults: action.liveResults,
      pendingResults: null,
    }
  }

  if (state.visibleResults.length === 0) {
    return {
      activeQuery: query,
      visibleResults: action.liveResults,
      pendingResults: null,
    }
  }

  if (stableSearchResultsEqual(state.visibleResults, action.liveResults)) {
    if (!state.pendingResults) {
      return state
    }

    return {
      ...state,
      pendingResults: null,
    }
  }

  return {
    ...state,
    pendingResults: action.liveResults,
  }
}

export function useStableSearchResults(query: string, liveResults: CustomSearchResult[]) {
  const [state, dispatch] = useReducer(
    stableSearchResultsReducer,
    initialStableSearchResultsState
  )

  useEffect(() => {
    dispatch({
      type: "sync",
      query,
      liveResults,
    })
  }, [query, liveResults])

  const applyPendingResults = useCallback(() => {
    dispatch({type: "applyPending"})
  }, [])

  return {
    visibleResults: state.visibleResults,
    pendingResults: state.pendingResults,
    hasPendingResults: Boolean(state.pendingResults),
    applyPendingResults,
  }
}
