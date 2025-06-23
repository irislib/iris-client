import {persist} from "zustand/middleware"
import {create} from "zustand"

interface DraftState {
  content: string
  imageMetadata: Record<string, {width: number; height: number; blurhash: string}>
  repliedEventId?: string
  quotedEventId?: string

  setContent: (content: string | ((prev: string) => string)) => void
  setImageMetadata: (
    metadata: Record<string, {width: number; height: number; blurhash: string}>
  ) => void
  setRepliedEventId: (id?: string) => void
  setQuotedEventId: (id?: string) => void
  reset: () => void
}

export const useDraftStore = create<DraftState>()(
  persist(
    (set) => {
      const initialState = {
        content: "",
        imageMetadata: {},
        repliedEventId: undefined,
        quotedEventId: undefined,
      }

      const actions = {
        setContent: (content: string | ((prev: string) => string)) =>
          set((state) => ({
            content: typeof content === "function" ? content(state.content) : content,
          })),
        setImageMetadata: (
          imageMetadata: Record<string, {width: number; height: number; blurhash: string}>
        ) => set({imageMetadata}),
        setRepliedEventId: (repliedEventId?: string) => set({repliedEventId}),
        setQuotedEventId: (quotedEventId?: string) => set({quotedEventId}),
        reset: () => set(initialState),
      }

      return {
        ...initialState,
        ...actions,
      }
    },
    {
      name: "draft-storage",
    }
  )
)

export const useDraftContent = () => useDraftStore((state) => state.content)
export const useDraftImageMetadata = () => useDraftStore((state) => state.imageMetadata)
export const useDraftRepliedEventId = () => useDraftStore((state) => state.repliedEventId)
export const useDraftQuotedEventId = () => useDraftStore((state) => state.quotedEventId)
