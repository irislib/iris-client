import {shouldHideAuthorMemoized} from "./memoizedVisibility"

export const shouldHideAuthor = shouldHideAuthorMemoized

export {shouldHideAuthorMemoized, clearVisibilityCache} from "./memoizedVisibility"

export const shouldHideEvent = (event: any): boolean => {
  if (shouldHideAuthor(event.author?.pubkey || event.pubkey)) {
    return true
  }

  return false
}

export const shouldHideReaction = (event: any): boolean => {
  if (shouldHideAuthor(event.author?.pubkey || event.pubkey)) {
    return true
  }

  return false
}

export const shouldHideRepost = (event: any): boolean => {
  if (shouldHideAuthor(event.author?.pubkey || event.pubkey)) {
    return true
  }

  return false
}

export const shouldHideComment = (event: any): boolean => {
  if (shouldHideAuthor(event.author?.pubkey || event.pubkey)) {
    return true
  }

  return false
}

export const shouldHideZap = (event: any): boolean => {
  if (shouldHideAuthor(event.author?.pubkey || event.pubkey)) {
    return true
  }

  return false
}

export const shouldHideProfile = (pubKey: string): boolean => {
  return shouldHideAuthor(pubKey)
}

export const shouldHideMessage = (event: any): boolean => {
  if (shouldHideAuthor(event.author?.pubkey || event.pubkey)) {
    return true
  }

  return false
}
