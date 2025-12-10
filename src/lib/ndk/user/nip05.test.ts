import {beforeEach, describe, expect, it, vi} from "vitest"
import {NDK} from "../ndk"
import {getNip05For} from "./nip05"

const ndk = new NDK()

describe("nip05", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe("getNip05For", () => {
    it("should parse nip46 relays even without relays being specified ", async () => {
      const json = {
        names: {
          bob: "b0635d6a9851d3aed0cd6c495b282167acf761729078d975fc341b22650b07b9",
        },
        nip46: {
          b0635d6a9851d3aed0cd6c495b282167acf761729078d975fc341b22650b07b9: [
            "wss://relay.nsec.app",
            "wss://other-relay.org",
          ],
        },
      }

      const fetchMock = vi.fn(() =>
        Promise.resolve({
          json: (): Promise<any> => Promise.resolve(json),
        } as Response)
      )

      const result = await getNip05For(ndk, "bob@nsec.app", fetchMock)

      expect(result?.pubkey).toEqual(
        "b0635d6a9851d3aed0cd6c495b282167acf761729078d975fc341b22650b07b9"
      )

      expect(result?.nip46).toEqual(["wss://relay.nsec.app", "wss://other-relay.org"])
    })

    it("should lowercase the name in the query", async () => {
      const json = {
        names: {
          bitcoinpainter: "abc123def456",
        },
      }

      const fetchMock = vi.fn(() =>
        Promise.resolve({
          json: (): Promise<any> => Promise.resolve(json),
        } as Response)
      )

      const result = await getNip05For(ndk, "Bitcoinpainter@iris.to", fetchMock)

      // Verify the fetch was called with lowercase name
      expect(fetchMock).toHaveBeenCalledWith(
        "https://iris.to/.well-known/nostr.json?name=bitcoinpainter",
        {}
      )

      expect(result?.pubkey).toEqual("abc123def456")
    })
  })
})
