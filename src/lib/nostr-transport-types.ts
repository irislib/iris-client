import type {RuntimeCompletion, RuntimePublishResult, RuntimeMetrics} from "nostr-pubsub"
import type {EventFilter} from "@/lib/nostr"
import type {SettingsState} from "../stores/settings"
import type {SearchResult} from "../utils/profileSearchData"
import type {SearchHitSource} from "../workers/profile-search"

export type {SearchResult} from "../utils/profileSearchData"

export interface WorkerSubscribeOpts {
  relayUrls?: string[]
  isolated?: boolean
  destinations?: ("cache" | "relay")[]
  closeOnEose?: boolean
  groupable?: boolean
  groupableDelay?: number
  waitForCacheBeforeRelays?: boolean
}

export interface WorkerPublishOpts {
  requireAck?: boolean
  publishTo?: ("cache" | "relay" | "subscriptions")[]
  verifySignature?: boolean
  source?: string
}

export interface LocalDataStats {
  pubsub?: RuntimeMetrics
  totalEvents: number
  eventsByKind: Record<number, number>
  databaseSize?: string
}

export interface WorkerMessage {
  type:
    | "init"
    | "peerSource"
    | "peerCache"
    | "authSigned"
    | "subscribe"
    | "unsubscribe"
    | "publish"
    | "close"
    | "getRelayStatus"
    | "getStats"
    | "addRelay"
    | "removeRelay"
    | "connectRelay"
    | "disconnectRelay"
    | "reconnectDisconnected"
    | "browserOffline"
    | "browserOnline"
    | "updateSettings"
    | "search"
    | "ping"
  error?: string
  port?: MessagePort
  id?: string
  filters?: EventFilter[]
  event?: unknown
  relays?: string[]
  url?: string
  subscribeOpts?: WorkerSubscribeOpts
  publishOpts?: WorkerPublishOpts
  reason?: string
  settings?: SettingsState
  searchQuery?: string
  searchRequestId?: number
  disableExtraRelayUrls?: boolean
}

export interface WorkerResponse {
  completion?: RuntimeCompletion
  publishResult?: RuntimePublishResult
  type:
    | "ready"
    | "signAuth"
    | "pong"
    | "event"
    | "eose"
    | "notice"
    | "published"
    | "error"
    | "relayStatus"
    | "relayStatusUpdate"
    | "stats"
    | "relayAdded"
    | "relayConnected"
    | "relayDisconnected"
    | "searchReady"
    | "searchResult"
  subId?: string
  event?: unknown
  relay?: string
  fromCache?: boolean
  notice?: string
  error?: string
  id?: string
  relayStatuses?: Array<{
    url: string
    status: number
    stats?: {
      attempts: number
      success: number
      connectedAt?: number
    }
  }>
  stats?: LocalDataStats
  searchRequestId?: number
  searchResults?: Array<{item: SearchResult; score?: number; source?: SearchHitSource}>
  searchComplete?: boolean
}
