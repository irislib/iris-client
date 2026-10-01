import {expect, it} from "vitest"
import {
  validPrivateDeviceLabel,
  portableLabel,
  compareDeviceLabel,
} from "./privateDeviceLabelProtocol"
const owner = "a".repeat(64),
  device = "b".repeat(64)
const data = {
  type: "device-labels",
  v: 2,
  owner,
  device,
  deviceLabel: "Home",
  clientLabel: null,
  updatedAtSecs: 1,
}
it("keeps null clears and counts Unicode scalars consistently with native", () => {
  expect(validPrivateDeviceLabel({...data, deviceLabel: null}, owner)).toBe(true)
  expect(validPrivateDeviceLabel({...data, deviceLabel: "💚".repeat(128)}, owner)).toBe(
    true
  )
  expect(validPrivateDeviceLabel({...data, deviceLabel: "💚".repeat(129)}, owner)).toBe(
    false
  )
  expect(
    validPrivateDeviceLabel({...data, deviceLabel: String.fromCharCode(0xd800)}, owner)
  ).toBe(false)
  expect(portableLabel("  Home\n ")).toBe("Home")
})
it("rejects a wrong account, control characters, and future revisions", () => {
  expect(validPrivateDeviceLabel(data, device)).toBe(false)
  expect(validPrivateDeviceLabel({...data, deviceLabel: "Bad\u0000name"}, owner)).toBe(
    false
  )
  expect(
    validPrivateDeviceLabel(
      {...data, updatedAtSecs: Math.floor(Date.now() / 1000) + 301},
      owner
    )
  ).toBe(false)
})
it("uses the native UTF8 label tie order with null tombstones", () => {
  expect(compareDeviceLabel(null, "A")).toBeLessThan(0)
  expect(compareDeviceLabel("💚", "\ufffd")).toBeGreaterThan(0)
  expect(compareDeviceLabel("Home", "Home")).toBe(0)
})
