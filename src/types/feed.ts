export type FeedType = "popular" | "for-you"

export interface FeedFilter {
  kinds?: number[]
  since?: number
  limit?: number
  search?: string
  authors?: string[]
  "#e"?: string[]
  "#g"?: string[]
  "#p"?: string[]
  "#t"?: string[]
  [key: `#${string}`]: string[] | undefined
}

export interface FeedConfig {
  name: string
  id: string
  customName?: string
  showRepliedTo?: boolean
  hideReplies?: boolean
  filter?: FeedFilter
  followDistance?: number // undefined = no follow distance filtering, number = max degrees
  requiresMedia?: boolean
  requiresReplies?: boolean
  requiresLocationTag?: boolean // For map feeds - only show events with g or location tags
  excludeSeen?: boolean
  relayUrls?: string[]
  // For reply feeds - only show replies to this specific event
  repliesTo?: string
  // Sort type for events
  sortType?: "chronological" | "followDistance" | "liked"
  // Show new events automatically without the dialog
  autoShowNewEvents?: boolean
  // Display mode for this specific feed
  displayAs?: "list" | "grid"
  // Feed strategy for popular feeds
  feedStrategy?: FeedType
  // Show zap all button
  showZapAll?: boolean
  // Show author in zap receipt headers
  showAuthorInZapReceipts?: boolean
  // Show events by unknown users in this feed
  showEventsByUnknownUsers?: boolean
}
