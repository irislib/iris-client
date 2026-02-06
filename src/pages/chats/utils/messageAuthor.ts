export type MessageAuthorLike = {
  pubkey: string
  ownerPubkey?: string
}

export const getMessageAuthorPubkey = (message: MessageAuthorLike): string =>
  message.ownerPubkey ?? message.pubkey

export const isMessageFromMe = (message: MessageAuthorLike, myPubKey: string): boolean =>
  getMessageAuthorPubkey(message) === myPubKey
