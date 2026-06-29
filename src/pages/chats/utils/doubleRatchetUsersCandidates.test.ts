import {describe, expect, it} from "vitest"

import {reconcileDoubleRatchetUserPubkeys} from "./doubleRatchetUsers"

describe("reconcileDoubleRatchetUserPubkeys", () => {
  it("uses explicit followed or messaged candidates instead of retaining stale entries", () => {
    expect(
      reconcileDoubleRatchetUserPubkeys({
        candidatePubkeys: ["followed", "messaged", "followed", "", "self"],
        currentPubkeys: ["stale-appkeys-user", "messaged", "self"],
        ownPubkey: "self",
      })
    ).toEqual(["followed", "messaged"])
  })
})
