import type {
  MeltQuoteResponse,
  MeltQuoteState,
  MintQuoteResponse,
  MintQuoteState,
  Token,
} from "@cashu/cashu-ts"
import type {HistoryRepository} from "../repositories"
import {EventBus} from "../events/EventBus"
import type {CoreEvents} from "../events/types"
import type {
  HistoryEntry,
  MeltHistoryEntry,
  MintHistoryEntry,
  ReceiveHistoryEntry,
  SendHistoryEntry,
} from "@core/models/History"
import type {Logger} from "@core/logging"

export class HistoryService {
  private readonly historyRepository: HistoryRepository
  private readonly logger?: Logger
  private readonly eventBus: EventBus<CoreEvents>

  constructor(
    historyRepository: HistoryRepository,
    eventBus: EventBus<CoreEvents>,
    logger?: Logger
  ) {
    this.historyRepository = historyRepository
    this.logger = logger
    this.eventBus = eventBus
    this.eventBus.on("mint-quote:state-changed", ({mintUrl, quoteId, state}) =>
      this.handleMintQuoteStateChanged(mintUrl, quoteId, state)
    )
    this.eventBus.on("mint-quote:created", ({mintUrl, quoteId, quote}) =>
      this.handleMintQuoteCreated(mintUrl, quoteId, quote)
    )
    this.eventBus.on("mint-quote:added", ({mintUrl, quoteId, quote}) =>
      this.handleMintQuoteAdded(mintUrl, quoteId, quote)
    )
    this.eventBus.on("melt-quote:created", ({mintUrl, quoteId, quote}) =>
      this.handleMeltQuoteCreated(mintUrl, quoteId, quote)
    )
    this.eventBus.on("melt-quote:state-changed", ({mintUrl, quoteId, state}) =>
      this.handleMeltQuoteStateChanged(mintUrl, quoteId, state)
    )
    this.eventBus.on("send:created", ({mintUrl, token, amount}) =>
      this.handleSendCreated(mintUrl, token, amount)
    )
    this.eventBus.on("receive:created", ({mintUrl, token, amount}) =>
      this.handleReceiveCreated(mintUrl, token, amount)
    )
    // this.eventBus.on('send:state-changed', this.handleSendStateChanged.bind(this));
    // this.eventBus.on('receive:state-changed', this.handleReceiveStateChanged.bind(this));
  }

  async getPaginatedHistory(offset = 0, limit = 25): Promise<HistoryEntry[]> {
    return this.historyRepository.getPaginatedHistoryEntries(limit, offset)
  }

  async handleSendCreated(mintUrl: string, token: Token, amount: number) {
    const entry: Omit<SendHistoryEntry, "id"> = {
      type: "send",
      createdAt: Date.now(),
      unit: token.unit || "sat",
      amount,
      mintUrl,
      token,
    }
    try {
      const entryRes = await this.historyRepository.addHistoryEntry(entry)
      await this.handleHistoryUpdated(mintUrl, entryRes)
    } catch (err) {
      this.logger?.error("Failed to add send created history entry", {
        mintUrl,
        token,
        err,
      })
    }
  }

  async handleReceiveCreated(mintUrl: string, token: Token, amount: number) {
    const entry: Omit<ReceiveHistoryEntry, "id"> = {
      type: "receive",
      createdAt: Date.now(),
      unit: token.unit || "sat",
      amount,
      mintUrl,
      token,
    }
    try {
      const entryRes = await this.historyRepository.addHistoryEntry(entry)
      await this.handleHistoryUpdated(mintUrl, entryRes)
    } catch (err) {
      this.logger?.error("Failed to add receive created history entry", {
        mintUrl,
        token,
        err,
      })
    }
  }

  async handleMintQuoteStateChanged(
    mintUrl: string,
    quoteId: string,
    state: MintQuoteState
  ) {
    try {
      const entry = await this.historyRepository.getMintHistoryEntry(mintUrl, quoteId)
      if (!entry) {
        this.logger?.error("Mint quote state changed history entry not found", {
          mintUrl,
          quoteId,
        })
        return
      }
      entry.state = state
      await this.historyRepository.updateHistoryEntry(entry)
      await this.handleHistoryUpdated(mintUrl, {...entry, state})
    } catch (err) {
      this.logger?.error("Failed to add mint quote state changed history entry", {
        mintUrl,
        quoteId,
        err,
      })
    }
  }

  async handleMeltQuoteStateChanged(
    mintUrl: string,
    quoteId: string,
    state: MeltQuoteState
  ) {
    try {
      const entry = await this.historyRepository.getMeltHistoryEntry(mintUrl, quoteId)
      if (!entry) {
        this.logger?.error("Melt quote state changed history entry not found", {
          mintUrl,
          quoteId,
        })
        return
      }
      entry.state = state
      await this.historyRepository.updateHistoryEntry(entry)
      await this.handleHistoryUpdated(mintUrl, {...entry, state})
    } catch (err) {
      this.logger?.error("Failed to add melt quote state changed history entry", {
        mintUrl,
        quoteId,
        err,
      })
    }
  }

  async handleMeltQuoteCreated(
    mintUrl: string,
    quoteId: string,
    quote: MeltQuoteResponse
  ) {
    const entry: Omit<MeltHistoryEntry, "id"> = {
      type: "melt",
      createdAt: Date.now(),
      unit: quote.unit,
      amount: quote.amount,
      mintUrl,
      quoteId,
      state: quote.state,
    }
    try {
      await this.historyRepository.addHistoryEntry(entry)
    } catch (err) {
      this.logger?.error("Failed to add melt quote created history entry", {
        mintUrl,
        quoteId,
        err,
      })
    }
  }

  async handleMintQuoteCreated(
    mintUrl: string,
    quoteId: string,
    quote: MintQuoteResponse
  ) {
    const entry: Omit<MintHistoryEntry, "id"> = {
      type: "mint",
      mintUrl,
      unit: quote.unit,
      paymentRequest: quote.request,
      quoteId,
      state: quote.state,
      createdAt: Date.now(),
      amount: quote.amount,
    }
    try {
      await this.historyRepository.addHistoryEntry(entry)
    } catch (err) {
      this.logger?.error("Failed to add mint quote created history entry", {
        mintUrl,
        quoteId,
        err,
      })
    }
  }

  async handleMintQuoteAdded(mintUrl: string, quoteId: string, quote: MintQuoteResponse) {
    // Check if history entry already exists for this quote
    const existing = await this.historyRepository.getMintHistoryEntry(mintUrl, quoteId)
    if (existing) {
      this.logger?.debug("History entry already exists for added mint quote", {
        mintUrl,
        quoteId,
      })
      return
    }

    const entry: Omit<MintHistoryEntry, "id"> = {
      type: "mint",
      mintUrl,
      unit: quote.unit,
      paymentRequest: quote.request,
      quoteId,
      state: quote.state,
      createdAt: Date.now(),
      amount: quote.amount,
    }
    try {
      const created = await this.historyRepository.addHistoryEntry(entry)
      await this.eventBus.emit("history:updated", {mintUrl, entry: created})
      this.logger?.debug("Added history entry for externally added mint quote", {
        mintUrl,
        quoteId,
        state: quote.state,
      })
    } catch (err) {
      this.logger?.error("Failed to add mint quote added history entry", {
        mintUrl,
        quoteId,
        err,
      })
    }
  }

  async handleHistoryUpdated(mintUrl: string, entry: HistoryEntry) {
    try {
      await this.eventBus.emit("history:updated", {mintUrl, entry})
    } catch (err) {
      this.logger?.error("Failed to emit history entry", {mintUrl, entry, err})
    }
  }
}
