import {create} from "zustand"

interface SocialGraphState {
  isReady: boolean
  isRecrawling: boolean
  version: number
  muteListVersion: number
  setReady: (isReady: boolean) => void
  setIsRecrawling: (isRecrawling: boolean) => void
  incrementVersion: () => void
  incrementMuteListVersion: () => void
}

export const useSocialGraphStore = create<SocialGraphState>((set) => ({
  isReady: false,
  isRecrawling: false,
  version: 0,
  muteListVersion: 0,
  setReady: (isReady: boolean) => set({isReady}),
  setIsRecrawling: (isRecrawling: boolean) => set({isRecrawling}),
  incrementVersion: () => set((state) => ({version: state.version + 1})),
  incrementMuteListVersion: () =>
    set((state) => ({muteListVersion: state.muteListVersion + 1})),
}))
