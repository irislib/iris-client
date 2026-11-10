import type {BrowserSignerSession} from "@iris/identity/browserSigner"
import type {Signer} from "@/lib/nostr"
import {User} from "@/lib/nostr"
import type {Event} from "nostr-tools"

export function createRemoteSigner(session: BrowserSignerSession): Signer {
  // Restoring the account is local. Open a private relay connection only for
  // a requested signature or encryption operation.
  const signer = async () =>
    (await import("@iris/identity/browserSigner")).restoreBrowserSigner(session)
  return {
    user: async () => new User({pubkey: session.pubkey}),
    sign: async (event: Event) => {
      if (event.pubkey !== session.pubkey) throw new Error("Signer account changed")
      return (await (await signer()).signEvent(event)).sig
    },
    encrypt: async (recipient, value, scheme = "nip44") => {
      const remote = await signer()
      if (scheme !== "nip44" || !remote.nip44Encrypt) {
        throw new Error("This signer supports NIP-44 encryption")
      }
      return remote.nip44Encrypt(recipient.pubkey, value)
    },
    decrypt: async (sender, value, scheme = "nip44") => {
      const remote = await signer()
      if (scheme !== "nip44" || !remote.nip44Decrypt) {
        throw new Error("This signer supports NIP-44 decryption")
      }
      return remote.nip44Decrypt(sender.pubkey, value)
    },
  }
}
