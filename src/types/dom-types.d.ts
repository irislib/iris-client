export interface RTCSessionDescriptionInit {
  type: RTCSdpType
  sdp: string
}

export type RTCSdpType = "answer" | "offer" | "pranswer" | "rollback"

export interface RTCIceCandidateInit {
  candidate?: string
  sdpMid?: string
  sdpMLineIndex?: number
  usernameFragment?: string
}
