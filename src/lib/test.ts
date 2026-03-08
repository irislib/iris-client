import {NDKNutzap} from "./ndk/events/kinds/nutzap/index.js"
import type {Proof} from "./ndk/events/kinds/nutzap/proof.js"
import type {NDK} from "./ndk/ndk/index.js"
import {NDKPrivateKeySigner} from "./ndk/signers/private-key/index.js"
import {NDKUser} from "./ndk/user/index.js"

const signerCache = new Map<string, NDKPrivateKeySigner>()

function getCachedSigner(name: string): NDKPrivateKeySigner {
  let signer = signerCache.get(name)
  if (!signer) {
    signer = NDKPrivateKeySigner.generate()
    signerCache.set(name, signer)
  }
  return signer
}

export const SignerGenerator = {
  getSigner(name: string): NDKPrivateKeySigner {
    return getCachedSigner(name)
  },

  async sign(
    event: {sign: (signer: NDKPrivateKeySigner) => Promise<unknown>},
    name: string
  ) {
    await event.sign(getCachedSigner(name))
  },
}

export const UserGenerator = {
  async getUser(name: string, ndk?: NDK): Promise<NDKUser> {
    const signer = getCachedSigner(name)
    const user = await signer.user()
    if (ndk) {
      return ndk.getUser({pubkey: user.pubkey})
    }
    return user
  },
}

export function mockProof(
  mint: string,
  amount: number,
  recipientPubkey?: string,
  tags: string[][] = []
): Proof {
  const payload = [
    "P2PK",
    {
      data: recipientPubkey ? `02${recipientPubkey}` : "02".padEnd(66, "0"),
      tags,
    },
  ]

  return {
    id: mint,
    amount,
    C: "0".repeat(64),
    secret: JSON.stringify(payload),
  }
}

export async function mockNutzap(
  mint: string,
  amount: number,
  ndk: NDK,
  opts: {
    senderPk?: NDKPrivateKeySigner
    recipientPubkey?: string
    eventId?: string
  } = {}
): Promise<NDKNutzap> {
  const senderSigner = opts.senderPk ?? SignerGenerator.getSigner("alice")
  const senderUser = await senderSigner.user()
  const recipientPubkey =
    opts.recipientPubkey ?? (await UserGenerator.getUser("bob", ndk)).pubkey

  const proofTags = [
    ["P", senderUser.pubkey],
    ...(opts.eventId ? [["e", opts.eventId]] : []),
  ]

  const nutzap = new NDKNutzap(ndk)
  nutzap.mint = mint
  nutzap.recipientPubkey = recipientPubkey
  nutzap.proofs = [mockProof(mint, amount, recipientPubkey, proofTags)]

  if (opts.eventId) {
    nutzap.tags.push(["e", opts.eventId])
  }

  await nutzap.sign(senderSigner)
  return nutzap
}
