import {describe, it, expect} from "vitest"
import {isOwnDeviceEvent} from "./sessionRouting"

const OWNER = "a".repeat(64)
const CURRENT_DEVICE = "b".repeat(64)
const OTHER_DEVICE = "c".repeat(64)
const OTHER_USER = "d".repeat(64)

const devices = [{identityPubkey: OTHER_DEVICE, createdAt: Math.floor(Date.now() / 1000)}]

describe("isOwnDeviceEvent", () => {
  it("treats registered devices as own", () => {
    const result = isOwnDeviceEvent(
      OTHER_DEVICE,
      OTHER_DEVICE,
      OWNER,
      CURRENT_DEVICE,
      devices
    )
    expect(result).toBe(true)
  })

  it("treats owner pubkey as own", () => {
    const result = isOwnDeviceEvent(OWNER, OWNER, OWNER, CURRENT_DEVICE, devices)
    expect(result).toBe(true)
  })

  it("treats current device pubkey as own", () => {
    const result = isOwnDeviceEvent(
      CURRENT_DEVICE,
      OTHER_USER,
      OWNER,
      CURRENT_DEVICE,
      devices
    )
    expect(result).toBe(true)
  })

  it("does not treat other users as own", () => {
    const result = isOwnDeviceEvent(
      OTHER_USER,
      OTHER_USER,
      OWNER,
      CURRENT_DEVICE,
      devices
    )
    expect(result).toBe(false)
  })
})
