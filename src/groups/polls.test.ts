import {describe, expect, it} from "vitest"
import {
  buildPollResponseTags,
  buildPollTags,
  parsePoll,
  tallyPollResponses,
  type PollEvent,
} from "./polls"

const hex = (n: number) => n.toString(16).padStart(64, "0")
const pollEvent = (tags: string[][] = []): PollEvent => ({
  id: hex(1),
  pubkey: hex(2),
  kind: 1068,
  created_at: 100,
  content: "What should we build?",
  tags: [["option", "a", "A"], ["option", "b", "B"], ["endsAt", "200"], ...tags],
})
const response = (overrides: Partial<PollEvent> = {}): PollEvent => ({
  id: hex(3),
  pubkey: hex(4),
  kind: 1018,
  created_at: 150,
  content: "",
  tags: [
    ["e", hex(1)],
    ["response", "a"],
  ],
  ...overrides,
})
const poll = () => parsePoll(pollEvent())!

// NIP-88 responses are signature-verified by the relay layer before this reducer.
describe("NIP-88 polls", () => {
  it("defaults to single choice and parses relay/deadline metadata", () => {
    expect(
      parsePoll(
        pollEvent([
          ["relay", "wss://relay.example"],
          ["relay", "https://example.com"],
        ])
      )
    ).toMatchObject({
      type: "singlechoice",
      endsAt: 200,
      relays: ["wss://relay.example/"],
    })
  })

  it("rejects malformed polls instead of inventing choices or deadlines", () => {
    for (const event of [
      {...pollEvent(), kind: 1},
      {...pollEvent(), id: "not-an-id"},
      {...pollEvent(), content: " "},
      pollEvent([["option", "a", "Duplicate"]]),
      pollEvent([["option", "!", "Invalid ID"]]),
      pollEvent([["polltype", "ranked"]]),
      pollEvent([["polltype"]]),
      pollEvent([["endsAt", "300"]]),
      {...pollEvent(), tags: [["option", "a", "A"]]},
      {
        ...pollEvent(),
        tags: [
          ["option", "a", "A"],
          ["option", "b", "B"],
          ["endsAt", "1e3"],
        ],
      },
      {
        ...pollEvent(),
        tags: [
          ["option", "a", "A"],
          ["option", "b", "B"],
          ["endsAt", "99"],
        ],
      },
    ])
      expect(parsePoll(event)).toBeNull()
  })

  it("uses the first response tag for single choice, even with extra responses", () => {
    const result = tallyPollResponses(
      poll(),
      [
        response({
          tags: [
            ["e", hex(1)],
            ["response", "b"],
            ["response", "a"],
          ],
        }),
      ],
      {now: 180}
    )
    expect(result.counts).toEqual({a: 0, b: 1})
    expect(result.total).toBe(1)
  })

  it("deduplicates selected IDs in multiple choice and uses voters as denominator", () => {
    const multiple = parsePoll(pollEvent([["polltype", "multiplechoice"]]))!
    const result = tallyPollResponses(
      multiple,
      [
        response({
          tags: [
            ["e", hex(1)],
            ["response", "b"],
            ["response", "a"],
            ["response", "b"],
          ],
        }),
      ],
      {now: 180}
    )
    expect(result.counts).toEqual({a: 1, b: 1})
    expect(result.total).toBe(1)
  })

  it("counts the latest valid event per key independently of relay arrival order", () => {
    const old = response()
    const changed = response({
      id: hex(5),
      created_at: 160,
      tags: [
        ["e", hex(1)],
        ["response", "b"],
      ],
    })
    const malformed = response({
      id: hex(6),
      created_at: 170,
      tags: [
        ["e", hex(1)],
        ["response", "missing"],
      ],
    })
    for (const events of [
      [old, changed, malformed],
      [malformed, changed, old, changed],
    ]) {
      const result = tallyPollResponses(poll(), events, {now: 180})
      expect(result.counts).toEqual({a: 0, b: 1})
      expect(result.responsesByPubkey.get(hex(4))?.event.id).toBe(hex(5))
    }
  })

  it("breaks timestamp ties by lowest event ID, without merging distinct keys", () => {
    const a = response({id: hex(8)})
    const b = response({
      id: hex(7),
      tags: [
        ["e", hex(1)],
        ["response", "b"],
      ],
    })
    const otherKey = response({id: hex(9), pubkey: hex(10)})
    for (const events of [
      [a, b, otherKey],
      [otherKey, b, a],
    ]) {
      expect(tallyPollResponses(poll(), events, {now: 180}).counts).toEqual({a: 1, b: 1})
    }
  })

  it("includes timestamps at the deadline, excluding future, early, late and unrelated events", () => {
    const events = [
      response({created_at: 200}),
      response({id: hex(5), pubkey: hex(5), created_at: 99}),
      response({id: hex(6), pubkey: hex(6), created_at: 201}),
      response({id: hex(7), pubkey: hex(7), kind: 1}),
      response({
        id: hex(8),
        pubkey: hex(8),
        tags: [
          ["e", hex(99)],
          ["response", "a"],
        ],
      }),
      response({
        id: hex(9),
        pubkey: hex(9),
        tags: [
          ["e", hex(1)],
          ["e", hex(99)],
          ["response", "a"],
        ],
      }),
      response({id: hex(10), pubkey: hex(10), tags: [["e", hex(1)]]}),
      response({id: hex(11), pubkey: "not-a-key"}),
    ]
    expect(tallyPollResponses(poll(), events, {now: 200}).total).toBe(1)
    expect(tallyPollResponses(poll(), events, {now: 199}).total).toBe(0)
  })

  it("re-evaluates membership from the supplied current policy view", () => {
    const events = [response(), response({id: hex(5), pubkey: hex(5)})]
    expect(
      tallyPollResponses(poll(), events, {now: 180, isEligible: (key) => key === hex(5)})
        .total
    ).toBe(1)
    expect(
      tallyPollResponses(poll(), events, {now: 180, isEligible: () => false}).total
    ).toBe(0)
  })

  it("creates interoperable poll and response tags and validates choices", () => {
    const tags = buildPollTags({
      options: ["  A  ", "B"],
      relays: ["wss://relay.example"],
      endsAt: 200,
    })
    expect(tags).toEqual([
      ["option", "1", "A"],
      ["option", "2", "B"],
      ["polltype", "singlechoice"],
      ["endsAt", "200"],
      ["relay", "wss://relay.example/"],
    ])
    expect(buildPollResponseTags(poll(), ["b"])).toEqual([
      ["e", hex(1)],
      ["response", "b"],
    ])
    expect(() => buildPollResponseTags(poll(), ["a", "b"])).toThrow()
    expect(() => buildPollResponseTags(poll(), [])).toThrow()
    expect(() => buildPollTags({options: ["A", " "], relays: []})).toThrow()
  })
})
