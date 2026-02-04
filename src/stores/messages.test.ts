import {beforeEach, describe, expect, it} from "vitest"
import {useMessagesStore} from "./messages"

describe("messages store", () => {
  beforeEach(() => {
    useMessagesStore.setState({enablePublicChats: false})
  })

  it("defaults public chats to disabled", () => {
    expect(useMessagesStore.getState().enablePublicChats).toBe(false)
  })

  it("can enable public chats", () => {
    useMessagesStore.getState().setEnablePublicChats(true)
    expect(useMessagesStore.getState().enablePublicChats).toBe(true)
  })
})
