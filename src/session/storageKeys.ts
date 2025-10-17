export const SESSION_MANAGER_VERSION = "1"
export const SESSION_MANAGER_VERSION_KEY = "session-manager-version"

const VERSION_PREFIX = `v${SESSION_MANAGER_VERSION}`

export const userRecordKey = (publicKey: string): string =>
  `${VERSION_PREFIX}/user/${publicKey}`

export const userRecordKeyPrefix = (): string => `${VERSION_PREFIX}/user/`

export const deviceInviteKey = (deviceId: string): string =>
  `${VERSION_PREFIX}/device-invite/${deviceId}`

export const userInviteKey = (publicKey: string): string =>
  `${VERSION_PREFIX}/invite/${publicKey}`

export const inviteAcceptKey = (
  nostrEventId: string,
  userPublicKey: string,
  deviceId: string
): string => `${VERSION_PREFIX}/invite-accept/${userPublicKey}/${deviceId}/${nostrEventId}`

export const inviteAcceptKeyPrefix = (userPublicKey: string): string =>
  `${VERSION_PREFIX}/invite-accept/${userPublicKey}/`

export const sessionKey = (
  userPublicKey: string,
  deviceId: string,
  sessionName: string
): string => `${VERSION_PREFIX}/session/${userPublicKey}/${deviceId}/${sessionName}`

export const sessionKeyPrefix = (userPublicKey: string): string =>
  `${VERSION_PREFIX}/session/${userPublicKey}/`
