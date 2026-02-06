import {beforeEach, describe, expect, it} from "vitest"
import {useMessagesStore} from "./messages"

describe("messages store", () => {
  beforeEach(() => {
    useMessagesStore.setState({
      enablePublicChats: false,
      sendDeliveryReceipts: true,
      sendReadReceipts: true,
      receiveMessageRequests: true,
    })
  })

  it("defaults public chats to disabled", () => {
    expect(useMessagesStore.getState().enablePublicChats).toBe(false)
  })

  it("can enable public chats", () => {
    useMessagesStore.getState().setEnablePublicChats(true)
    expect(useMessagesStore.getState().enablePublicChats).toBe(true)
  })

  it("defaults delivery receipts to enabled", () => {
    expect(useMessagesStore.getState().sendDeliveryReceipts).toBe(true)
  })

  it("can disable delivery receipts", () => {
    useMessagesStore.getState().setSendDeliveryReceipts(false)
    expect(useMessagesStore.getState().sendDeliveryReceipts).toBe(false)
  })

  it("defaults read receipts to enabled", () => {
    expect(useMessagesStore.getState().sendReadReceipts).toBe(true)
  })

  it("can disable read receipts", () => {
    useMessagesStore.getState().setSendReadReceipts(false)
    expect(useMessagesStore.getState().sendReadReceipts).toBe(false)
  })

  it("defaults message requests to enabled", () => {
    expect(useMessagesStore.getState().receiveMessageRequests).toBe(true)
  })

  it("can disable message requests", () => {
    useMessagesStore.getState().setReceiveMessageRequests(false)
    expect(useMessagesStore.getState().receiveMessageRequests).toBe(false)
  })
})
