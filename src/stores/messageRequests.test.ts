import {beforeEach, describe, expect, it} from "vitest"

import {useMessageRequestsStore} from "./messageRequests"

describe("messageRequests store", () => {
  beforeEach(() => {
    useMessageRequestsStore.setState({acceptedChats: {}, rejectedChats: {}})
  })

  it("acceptChat marks chat as accepted and clears rejected", () => {
    useMessageRequestsStore.getState().rejectChat("a")
    expect(useMessageRequestsStore.getState().rejectedChats["a"]).toBe(true)

    useMessageRequestsStore.getState().acceptChat("a")
    expect(useMessageRequestsStore.getState().acceptedChats["a"]).toBe(true)
    expect(useMessageRequestsStore.getState().rejectedChats["a"]).toBeUndefined()
  })

  it("rejectChat marks chat as rejected and clears accepted", () => {
    useMessageRequestsStore.getState().acceptChat("b")
    expect(useMessageRequestsStore.getState().acceptedChats["b"]).toBe(true)

    useMessageRequestsStore.getState().rejectChat("b")
    expect(useMessageRequestsStore.getState().rejectedChats["b"]).toBe(true)
    expect(useMessageRequestsStore.getState().acceptedChats["b"]).toBeUndefined()
  })
})
