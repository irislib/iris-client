import {expect, it, vi} from "vitest"
import {nhashDecode, sha256, toHex} from "@hashtree/core"
import {downloadFile, uploadFile} from "./hashtree"
import {localBlocks} from "./fileStore"

vi.mock("@/stores/user", () => ({useUserStore: {getState: () => ({publicKey: "signed-in"})}}))
vi.mock("./peerRuntime", () => ({getPeerRuntime: async () => null}))
vi.mock("@/utils/nostrClient", async () => {
  const {SecretKeySigner} = await import("./nostr")
  const signer = SecretKeySigner.generate()
  return {nostr: () => ({signer})}
})

it("uploads versioned ciphertext and reads the attachment back from Blossom with its share link", async () => {
  const blocks = new Map<string, Uint8Array>()
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    if (init?.method === "PUT") {
      const bytes = new Uint8Array(await (init.body as Blob).arrayBuffer())
      const hash = toHex(await sha256(bytes))
      blocks.set(hash, bytes)
      return Response.json({sha256: hash}, {status: 201})
    }
    const hash = new URL(url).pathname.slice(1).replace(/\.bin$/, "")
    const bytes = blocks.get(hash)
    return bytes ? new Response(new Uint8Array(bytes)) : new Response(null, {status: 404})
  })
  try {
    const plaintext = new TextEncoder().encode("Encrypted attachment round trip")
    const {nhash} = await uploadFile(new File([plaintext], "attachment.txt"))
    const cid = nhashDecode(nhash)
    expect(cid.key).toHaveLength(33)
    expect(cid.key?.[0]).toBe(1)
    await vi.waitFor(() => expect(blocks.has(toHex(cid.hash))).toBe(true))
    expect(blocks.get(toHex(cid.hash))).not.toEqual(plaintext)
    await localBlocks.clear()
    expect(await downloadFile(nhash)).toEqual(plaintext)
  } finally {
    vi.unstubAllGlobals()
  }
})
