import {expect, it} from "vitest"
import {withLocalChatNotices} from "./localChatNotices"
import type {MessageType} from "../message/Message"

it("places private approvals between messages without creating outgoing events", () => {
  const first = {id: "first", created_at: 10, tags: []} as unknown as MessageType
  const second = {id: "second", created_at: 30, tags: []} as unknown as MessageType
  const notice = {
    id: "approval",
    timestamp: 20000,
    content: "You approved Alice → Alicia",
  }
  const timeline = withLocalChatNotices([[first, second]], [notice], true)
  expect(timeline).toEqual([
    {type: "messages", timestamp: 10000, messages: [first]},
    {type: "notice", timestamp: 20000, notice},
    {type: "messages", timestamp: 30000, messages: [second]},
  ])
})

it("shows approvals in an empty conversation and waits for older history to load", () => {
  const notice = {id: "approval", timestamp: 10000, content: "You approved a name"}
  expect(withLocalChatNotices([], [notice], true)).toHaveLength(1)
  const message = {id: "later", created_at: 30, tags: []} as unknown as MessageType
  expect(withLocalChatNotices([[message]], [notice], false)).toHaveLength(1)
  expect(withLocalChatNotices([[message]], [notice], true)).toHaveLength(2)
})
