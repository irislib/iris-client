import type {NostrEvent} from "../events"
import type {NDKEvent} from "../events"
import type {
  NDKFilter,
  NDKSubscription,
  NDKSubscriptionDelayedType,
  NDKSubscriptionInternalId,
} from "../subscription"
import type {NDKFilterFingerprint} from "../subscription/grouping"
import {mergeFilters} from "../subscription/grouping"
import type {NDKSubscriptionManager} from "../subscription/manager"
import {formatFilters} from "../subscription/utils/format-filters"
import type {NDKRelay} from "."
import {NDKRelayStatus} from "."
import {buildStorageVector, negentropySync} from "../negentropy/index.js"
import {isReplaceableKind, isAddressableKind} from "nostr-tools/kinds"

type Item = {
  subscription: NDKSubscription
  filters: NDKFilter[]
}

/**
 * Determines if filters should use Negentropy sync.
 * Criteria: no limit or limit >= 20, and no ids filter
 */
function shouldUseNegentropy(
  filters: NDKFilter[],
  explicitPreference?: boolean
): boolean {
  // Respect explicit user preference if provided
  if (explicitPreference !== undefined) {
    return explicitPreference
  }

  // Fall back to automatic heuristic
  return filters.every((filter) => {
    // Skip if has ids filter
    if (filter.ids && filter.ids.length > 0) return false

    // Skip if single author + replaceable kinds
    // (relays only keep latest, negentropy pointless)
    if (filter.authors?.length === 1 && filter.kinds) {
      const allReplaceable = filter.kinds.every(isReplaceableKind)
      if (allReplaceable) return false

      // Skip if addressable/parameterized replaceable with "d" tag filter
      const hasAddressable = filter.kinds.some(isAddressableKind)
      if (hasAddressable && filter["#d"]) return false
    }

    // Use Negentropy if no limit or limit >= 20
    return !filter.limit || filter.limit >= 20
  })
}

export enum NDKRelaySubscriptionStatus {
  INITIAL = 0,

  /**
   * The subscription is pending execution.
   */
  PENDING = 1,

  /**
   * The subscription is waiting for the relay to be ready.
   */
  WAITING = 2,

  /**
   * The subscription is currently running.
   */
  RUNNING = 3,
  CLOSED = 4,
}

/**
 * Groups together a number of NDKSubscriptions (as created by the user),
 * filters (as computed internally), executed, or to be executed, within
 * a single specific relay.
 */
export class NDKRelaySubscription {
  public fingerprint: NDKFilterFingerprint
  public items: Map<NDKSubscriptionInternalId, Item> = new Map()
  public topSubManager: NDKSubscriptionManager

  public debug: debug.Debugger

  /**
   * Tracks the status of this REQ.
   */
  public status: NDKRelaySubscriptionStatus = NDKRelaySubscriptionStatus.INITIAL

  public onClose?: (sub: NDKRelaySubscription) => void

  private relay: NDKRelay

  /**
   * Whether this subscription has reached EOSE.
   */
  private eosed = false

  /**
   * Timeout at which this subscription will
   * start executing.
   */
  private executionTimer?: NodeJS.Timeout | number

  /**
   * Track the time at which this subscription will fire.
   */
  private fireTime?: number

  /**
   * The delay type that the current fireTime was calculated with.
   */
  private delayType?: NDKSubscriptionDelayedType

  /**
   * The filters that have been executed.
   */
  public executeFilters?: NDKFilter[]

  readonly id = Math.random().toString(36).substring(7)

  /**
   *
   * @param fingerprint The fingerprint of this subscription.
   */
  constructor(
    relay: NDKRelay,
    fingerprint: NDKFilterFingerprint | null,
    topSubManager: NDKSubscriptionManager
  ) {
    this.relay = relay
    this.topSubManager = topSubManager
    this.debug = relay.debug.extend(`sub[${this.id}]`)
    this.fingerprint = fingerprint || Math.random().toString(36).substring(7)
  }

  private _subId?: string

  get subId(): string {
    if (this._subId) return this._subId

    this._subId = this.fingerprint.slice(0, 15)
    return this._subId
  }

  private subIdParts = new Set<string>()
  private addSubIdPart(part: string) {
    this.subIdParts.add(part)
  }

  public addItem(subscription: NDKSubscription, filters: NDKFilter[]) {
    this.debug("Adding item", {
      filters: formatFilters(filters),
      internalId: subscription.internalId,
      status: this.status,
      fingerprint: this.fingerprint,
      id: this.subId,
      itemsSize: this.items.size,
    })
    if (this.items.has(subscription.internalId)) {
      return
    }

    subscription.on("close", this.removeItem.bind(this, subscription))
    this.items.set(subscription.internalId, {subscription, filters})

    if (this.status !== NDKRelaySubscriptionStatus.RUNNING) {
      // if we have an explicit subId in this subscription, append it to the subId
      if (subscription.subId && (!this._subId || this._subId.length < 25)) {
        if (
          this.status === NDKRelaySubscriptionStatus.INITIAL ||
          this.status === NDKRelaySubscriptionStatus.PENDING
        ) {
          this.addSubIdPart(subscription.subId)
        }
      }
    }

    switch (this.status) {
      case NDKRelaySubscriptionStatus.INITIAL:
        this.evaluateExecutionPlan(subscription)
        break
      case NDKRelaySubscriptionStatus.RUNNING:
        break
      case NDKRelaySubscriptionStatus.PENDING:
        // this subscription is already scheduled to be executed
        // we need to evaluate whether this new NDKSubscription
        // modifies our execution plan
        this.evaluateExecutionPlan(subscription)
        break
      case NDKRelaySubscriptionStatus.CLOSED:
        this.debug("Subscription is closed, cannot add new items", {
          filters: formatFilters(filters),
          subId: subscription.subId,
          internalId: subscription.internalId,
        })
        throw new Error("Cannot add new items to a closed subscription")
    }
  }

  /**
   * A subscription has been closed, remove it from the list of items.
   * @param subscription
   */
  public removeItem(subscription: NDKSubscription) {
    // this.debug("Removing item", { filters: subscription.filters, internalId: subscription.internalId, status: this.status, id: this.subId, fingerprint: this.fingerprint, items: this.items, itemsSize: this.items.size });
    this.items.delete(subscription.internalId)

    if (this.items.size === 0) {
      // if we haven't received an EOSE yet, don't close, relays don't like that
      // rather, when we EOSE and we have 0 items we will close there.
      if (!this.eosed) return

      // no more items, close the subscription
      this.close()
      this.cleanup()
    }
  }

  private close() {
    if (this.status === NDKRelaySubscriptionStatus.CLOSED) return

    const prevStatus = this.status
    this.status = NDKRelaySubscriptionStatus.CLOSED
    if (prevStatus === NDKRelaySubscriptionStatus.RUNNING) {
      try {
        this.relay.close(this.subId)
      } catch (e) {
        this.debug("Error closing subscription", e, this)
      }
    } else {
      this.debug(
        "Subscription wanted to close but it wasn't running, this is probably ok",
        {
          subId: this.subId,
          prevStatus,
          sub: this,
        }
      )
    }
    this.cleanup()
  }

  public cleanup() {
    // remove delayed execution
    if (this.executionTimer) clearTimeout(this.executionTimer as NodeJS.Timeout)

    // remove callback from relay
    this.relay.off("ready", this.executeOnRelayReady)
    this.relay.off("authed", this.reExecuteAfterAuth)

    // callback
    if (this.onClose) this.onClose(this)
  }

  private evaluateExecutionPlan(subscription: NDKSubscription) {
    if (!subscription.isGroupable()) {
      // execute immediately
      this.status = NDKRelaySubscriptionStatus.PENDING
      this.execute()
      return
    }

    // if the subscription is adding a limit filter we want to make sure
    // we are not adding too many, since limit filters concatenate filters instead of merging them
    // (as merging them would change the meaning)
    if (subscription.filters.find((filter) => !!filter.limit)) {
      // compile the filter
      this.executeFilters = this.compileFilters()

      // if we have 10 filters, we execute immediately, as most relays don't want more than 10
      if (this.executeFilters.length >= 10) {
        this.status = NDKRelaySubscriptionStatus.PENDING
        this.execute()
        return
      }
    }

    const delay = subscription.groupableDelay
    const delayType = subscription.groupableDelayType

    if (!delay) throw new Error("Cannot group a subscription without a delay")

    if (this.status === NDKRelaySubscriptionStatus.INITIAL) {
      this.schedule(delay, delayType)
    } else {
      // we already scheduled it, do we need to change it?
      const existingDelayType = this.delayType
      const timeUntilFire = this.fireTime! - Date.now()

      if (existingDelayType === "at-least" && delayType === "at-least") {
        if (timeUntilFire < delay) {
          // extend the timeout to the bigger timeout
          if (this.executionTimer) clearTimeout(this.executionTimer as NodeJS.Timeout)
          this.schedule(delay, delayType)
        }
      } else if (existingDelayType === "at-least" && delayType === "at-most") {
        if (timeUntilFire > delay) {
          if (this.executionTimer) clearTimeout(this.executionTimer as NodeJS.Timeout)
          this.schedule(delay, delayType)
        }
      } else if (existingDelayType === "at-most" && delayType === "at-most") {
        if (timeUntilFire > delay) {
          if (this.executionTimer) clearTimeout(this.executionTimer as NodeJS.Timeout)
          this.schedule(delay, delayType)
        }
      } else if (existingDelayType === "at-most" && delayType === "at-least") {
        if (timeUntilFire > delay) {
          if (this.executionTimer) clearTimeout(this.executionTimer as NodeJS.Timeout)
          this.schedule(delay, delayType)
        }
      } else {
        throw new Error(
          `Unknown delay type combination ${existingDelayType} ${delayType}`
        )
      }
    }
  }

  private schedule(delay: number, delayType: NDKSubscriptionDelayedType) {
    this.status = NDKRelaySubscriptionStatus.PENDING
    const currentTime = Date.now()
    this.fireTime = currentTime + delay
    this.delayType = delayType
    const timer = setTimeout(this.execute.bind(this), delay)

    /**
     * We only store the execution timer if it's an "at-least" delay,
     * since "at-most" delays should not be cancelled.
     */
    if (delayType === "at-least") {
      this.executionTimer = timer
    }
  }

  private executeOnRelayReady = () => {
    if (this.status !== NDKRelaySubscriptionStatus.WAITING) return
    if (this.items.size === 0) {
      this.debug(
        "No items to execute; this relay was probably too slow to respond and the caller gave up",
        {
          status: this.status,
          fingerprint: this.fingerprint,
          id: this.id,
          subId: this.subId,
        }
      )
      this.cleanup()
      return
    }

    this.debug("Executing on relay ready", {
      status: this.status,
      fingerprint: this.fingerprint,
      itemsSize: this.items.size,
      filters: formatFilters(this.compileFilters()),
    })

    this.status = NDKRelaySubscriptionStatus.PENDING
    this.execute()
  }

  private finalizeSubId() {
    // if we have subId parts, join those
    if (this.subIdParts.size > 0) {
      // Truncate individual parts and limit total length
      const parts = Array.from(this.subIdParts).map((part) => part.substring(0, 10))
      let joined = parts.join("-")

      // Ensure total subId doesn't exceed reasonable length (20 chars + 5 for random)
      if (joined.length > 20) {
        joined = joined.substring(0, 20)
      }

      this._subId = joined
    } else {
      this._subId = this.fingerprint.slice(0, 15)
    }

    this._subId += `-${Math.random().toString(36).substring(2, 7)}`
  }

  // we do it this way so that we can remove the listener
  private reExecuteAfterAuth = (() => {
    const oldSubId = this.subId
    this.debug("Re-executing after auth", this.items.size)
    if (this.eosed) {
      // we already received eose, so we can immediately close the old subscription
      // to create the new one
      this.relay.close(this.subId)
    } else {
      // relays don't like to have the subscription close before they eose back,
      // so wait until we eose before closing the old subscription
      this.debug(
        "We are abandoning an opened subscription, once it EOSE's, the handler will close it",
        {
          oldSubId,
        }
      )
    }
    this._subId = undefined
    this.status = NDKRelaySubscriptionStatus.PENDING
    this.execute()
    this.debug("Re-executed after auth %s 👉 %s", oldSubId, this.subId)
  }).bind(this)

  private async execute() {
    if (this.status !== NDKRelaySubscriptionStatus.PENDING) {
      // Because we might schedule this execution multiple times,
      // ensure we only execute once
      return
    }

    // check on the relay connectivity status
    if (!this.relay.connected) {
      this.status = NDKRelaySubscriptionStatus.WAITING
      this.debug("Waiting for relay to be ready", {
        status: this.status,
        id: this.subId,
        fingerprint: this.fingerprint,
        itemsSize: this.items.size,
      })
      this.relay.once("ready", this.executeOnRelayReady)
      return
    }
    if (this.relay.status < NDKRelayStatus.AUTHENTICATED) {
      this.relay.once("authed", this.reExecuteAfterAuth)
    }

    this.status = NDKRelaySubscriptionStatus.RUNNING

    this.finalizeSubId()

    this.executeFilters = this.compileFilters()

    // Check NDK-level negentropy setting
    const ndk = (this.relay.connectivity as any)?.ndk
    const globalNegentropyEnabled = ndk?.negentropyEnabled ?? false

    // Check if any subscription explicitly requested Negentropy
    const explicitUseNegentropy = Array.from(this.items.values()).find(
      (item) => item.subscription.opts.useNegentropy !== undefined
    )?.subscription.opts.useNegentropy

    // Global setting takes precedence if disabled
    const effectiveNegPreference = globalNegentropyEnabled ? explicitUseNegentropy : false

    // Try Negentropy (NIP-77) if applicable and not disabled
    const shouldUseNeg = shouldUseNegentropy(this.executeFilters, effectiveNegPreference)
    const negSupported = this.relay.negentropySupport !== false

    if (shouldUseNeg && negSupported) {
      const success = await this.tryNegentropy()
      if (success) {
        return // Negentropy succeeded, we're done
      }
      this.debug("Negentropy failed, falling back to REQ")
    } else {
      if (!shouldUseNeg) {
        this.debug("Skipping negentropy: filter not eligible", {
          filters: formatFilters(this.executeFilters || []),
        })
      } else if (!negSupported) {
        this.debug("Skipping negentropy: relay marked as unsupported", {
          negentropySupport: this.relay.negentropySupport,
        })
      }
    }

    // Fall back to standard REQ
    this.relay.req(this)
  }

  /**
   * Attempts Negentropy sync. Returns true if successful, false if should fallback to REQ.
   */
  private async tryNegentropy(): Promise<boolean> {
    const ndk = (this.relay.connectivity as any).ndk
    if (!ndk?.cacheAdapter) {
      this.debug("tryNegentropy failed: no cache adapter")
      return false
    }

    this.debug("Attempting Negentropy sync", {
      filters: formatFilters(this.executeFilters || []),
      negentropySupport: this.relay.negentropySupport,
    })

    try {
      // Get cached events for this filter to build storage vector
      const cachedEvents: NDKEvent[] = []
      for (const filter of this.executeFilters || []) {
        const events = await ndk.cacheAdapter.query({
          filters: [filter],
          ndk,
        } as any)
        if (Array.isArray(events)) {
          cachedEvents.push(...events)
        }
      }

      const storage = buildStorageVector(cachedEvents)
      const filter = this.executeFilters?.[0]
      if (!filter) {
        this.debug("tryNegentropy failed: no filter")
        return false
      }

      // Set up timeout and abort
      const abortController = new AbortController()
      const timeout = setTimeout(() => {
        this.debug("Negentropy timeout")
        if (this.relay.negentropySupport !== true) {
          this.relay.negentropySupport = false
        }
        abortController.abort()
      }, 10000)

      let haveCount = 0
      let needCount = 0
      const allNeededIds: string[] = []

      const reconcile = async (have: string[], need: string[]) => {
        // have: relay has, we don't (need to fetch)
        // need: we have, relay doesn't (would send if bidirectional)
        haveCount += have.length
        needCount += need.length

        // Collect event IDs that relay has but we don't
        if (have.length > 0) {
          allNeededIds.push(...have)
        }
      }

      // Get frame size limit from subscription options or use default
      const frameSizeLimit =
        Array.from(this.items.values()).find(
          (item) => item.subscription.opts.negentropyFrameSizeLimit !== undefined
        )?.subscription.opts.negentropyFrameSizeLimit || 60000

      const syncSuccess = await negentropySync(storage, this.relay, filter, reconcile, {
        signal: abortController.signal,
        frameSizeLimit,
      })

      clearTimeout(timeout)

      if (syncSuccess) {
        this.debug("Negentropy sync completed", {
          have: haveCount,
          need: needCount,
          total: haveCount + needCount,
        })

        // NIP-77 is supported, no need to cache (absence from unsupportedNips means supported)

        // Fetch needed events if any
        if (allNeededIds.length > 0) {
          this.debug("Fetching needed events", {count: allNeededIds.length})

          // Create a temporary subscription to fetch missing events
          const fetchSubId = `${this.subId}-fetch-${Math.random().toString(36).substring(2, 7)}`
          const fetchFilter = {ids: allNeededIds}

          // Register handler for fetched events
          const handleFetchedEvent = (_relay: NDKRelay, message: unknown[]) => {
            if (message[0] !== "EVENT" || message[1] !== fetchSubId) return
            this.onevent(message[2] as NostrEvent)
          }

          const handleFetchEose = (_relay: NDKRelay, message: unknown[]) => {
            if (message[0] !== "EOSE" || message[1] !== fetchSubId) return
            this.relay.unregisterProtocolHandler("EVENT")
            this.relay.unregisterProtocolHandler("EOSE")
            ;(this.relay.connectivity as any).send(JSON.stringify(["CLOSE", fetchSubId]))
            this.oneose(this.subId)
          }

          this.relay.registerProtocolHandler("EVENT", handleFetchedEvent)
          this.relay.registerProtocolHandler("EOSE", handleFetchEose)

          // Send REQ for missing events
          ;(this.relay.connectivity as any).send(
            JSON.stringify(["REQ", fetchSubId, fetchFilter])
          )
        } else {
          // No events to fetch, emit EOSE
          this.oneose(this.subId)
        }

        return true
      }

      this.debug("tryNegentropy failed: sync unsuccessful")
      return false
    } catch (error: any) {
      // Check if it's an unsupported error
      if (
        error?.message?.toLowerCase().includes("unsupported") ||
        error?.message?.toLowerCase().includes("not implemented")
      ) {
        this.debug("Relay does not support negentropy:", error.message)
        if (this.relay.negentropySupport !== true) {
          this.relay.negentropySupport = false
        }
      } else {
        this.debug("Negentropy sync error:", error)
      }
      return false
    }
  }

  public onstart() {}
  public onevent(event: NostrEvent | NDKEvent) {
    this.topSubManager.dispatchEvent(event, this.relay, false, this.items)
  }

  public oneose(subId: string) {
    this.eosed = true

    // if this is a different subId, then it belongs to a previously
    // created subscription we have abandoned; we can clean it up here
    if (subId !== this.subId) {
      this.debug("Received EOSE for an abandoned subscription", subId, this.subId)
      this.relay.close(subId)
      return
    }

    // if we don't have any items left, this is a subscription in a slow
    // relay and the subscriptions have been EOSEd due to a timeout, we can
    // close this subscription
    if (this.items.size === 0) {
      this.close()
    }

    for (const {subscription} of this.items.values()) {
      subscription.eoseReceived(this.relay)

      if (subscription.closeOnEose) {
        this.debug("Removing item because of EOSE", {
          filters: formatFilters(subscription.filters),
          internalId: subscription.internalId,
          status: this.status,
          fingerprint: this.fingerprint,
          itemsSize: this.items.size,
        })
        this.removeItem(subscription)
      }
    }
  }

  public onclose(_reason?: string) {
    this.status = NDKRelaySubscriptionStatus.CLOSED
  }

  public onclosed(reason?: string) {
    if (!reason) return

    for (const {subscription} of this.items.values()) {
      subscription.closedReceived(this.relay, reason)
    }
  }

  /**
   * Grabs the filters from all the subscriptions
   * and merges them into a single filter.
   */
  private compileFilters(): NDKFilter[] {
    const mergedFilters: NDKFilter[] = []
    const filters = Array.from(this.items.values()).map((item) => item.filters)

    if (!filters[0]) {
      this.debug("👀 No filters to merge", {itemsSize: this.items.size})
      return []
    }
    const filterCount = filters[0].length

    for (let i = 0; i < filterCount; i++) {
      const allFiltersAtIndex = filters.map((filter) => filter[i])
      const merged = mergeFilters(allFiltersAtIndex)
      mergedFilters.push(...merged)
    }

    return mergedFilters
  }
}
