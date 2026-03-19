import type {SessionUserRecordsLike} from "@/utils/sessionRouting"

type ChatMessageLike = {
  ownerPubkey?: string | null
  pubkey: string
}

type SessionStateWithActivity = {
  theirCurrentNostrPublicKey?: string
  theirNextNostrPublicKey?: string
  sendingChainMessageNumber?: number
  previousSendingChainMessageCount?: number
}

type SessionLike = {
  state?: SessionStateWithActivity | null
}

type SessionDeviceLike = {
  activeSession?: SessionLike | null
  inactiveSessions?: Array<SessionLike | null>
}

function sessionMatchesRecipient(
  recordPubkey: string,
  session: SessionLike | null | undefined,
  recipientPubkey: string
): boolean {
  const state = session?.state
  if (!state) return false

  return (
    recordPubkey === recipientPubkey ||
    state.theirCurrentNostrPublicKey === recipientPubkey ||
    state.theirNextNostrPublicKey === recipientPubkey
  )
}

function sessionHasOutgoingActivity(session: SessionLike | null | undefined): boolean {
  const state = session?.state
  if (!state) return false

  return (
    (state.sendingChainMessageNumber ?? 0) > 0 ||
    (state.previousSendingChainMessageCount ?? 0) > 0
  )
}

export function hasOutgoingSessionActivityWithRecipient(
  userRecords: SessionUserRecordsLike | null | undefined,
  recipientPubkey: string
): boolean {
  if (!userRecords || !recipientPubkey) return false

  for (const [recordPubkey, userRecord] of userRecords.entries()) {
    const devices = userRecord?.devices as Map<string, SessionDeviceLike> | undefined
    if (!devices) continue

    for (const device of devices.values()) {
      const sessions = [device.activeSession, ...(device.inactiveSessions ?? [])]
      for (const session of sessions) {
        if (
          sessionMatchesRecipient(recordPubkey, session, recipientPubkey) &&
          sessionHasOutgoingActivity(session)
        ) {
          return true
        }
      }
    }
  }

  return false
}

export function hasSentMessageInChat(
  messages: Iterable<ChatMessageLike> | null | undefined,
  myPubKey: string | null | undefined
): boolean {
  if (!messages || !myPubKey) return false

  for (const message of messages) {
    const owner = message.ownerPubkey ?? message.pubkey
    if (owner === myPubKey) {
      return true
    }
  }

  return false
}

export function isPrivateChatAccepted(options: {
  recipientPubkey: string
  isFollowed: boolean
  isLocallyAccepted: boolean
  messages?: Iterable<ChatMessageLike> | null
  myPubKey?: string | null
  sessionUserRecords?: SessionUserRecordsLike | null
}): boolean {
  const {
    recipientPubkey,
    isFollowed,
    isLocallyAccepted,
    messages,
    myPubKey,
    sessionUserRecords,
  } = options

  return (
    isFollowed ||
    isLocallyAccepted ||
    hasSentMessageInChat(messages, myPubKey) ||
    hasOutgoingSessionActivityWithRecipient(sessionUserRecords, recipientPubkey)
  )
}
