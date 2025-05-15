import NDK, {
  NDKConstructorParams,
  NDKNip07Signer,
  NDKPrivateKeySigner,
  NDKRelay,
  NDKRelayAuthPolicies,
  NDKUser,
  NDKEvent,
} from "@nostr-dev-kit/ndk"
import {generateSecretKey, getPublicKey, nip19} from "nostr-tools"
import NDKCacheAdapterDexie from "@nostr-dev-kit/ndk-cache-dexie"
import {bytesToHex, hexToBytes} from "@noble/hashes/utils"
import {useUserStore} from "@/stores/user"

let ndkInstance: NDK | null = null
let privateKeySigner: NDKPrivateKeySigner | undefined
let nip07Signer: NDKNip07Signer | undefined

/**
 * Default relays to use when initializing NDK
 */
export const DEFAULT_RELAYS = [
  "wss://strfry.iris.to",
  "wss://relay.damus.io",
  "wss://relay.nostr.band",
  "wss://relay.snort.social",
]

/**
 * Get a singleton "default" NDK instance to get started quickly. If you want to init NDK with e.g. your own relays, pass them on the first call.
 *
 * This needs to be called to make nip07 login features work.
 * @throws Error if NDK init options are passed after the first call
 */
export const ndk = (opts?: NDKConstructorParams): NDK => {
  if (!ndkInstance) {
    const options = opts || {
      explicitRelayUrls: DEFAULT_RELAYS,
      enableOutboxModel: true,
      cacheAdapter: new NDKCacheAdapterDexie({dbName: "irisdb-nostr"}),
    }
    ndkInstance = new NDK(options)
    watchLocalSettings(ndkInstance)
    ndkInstance.relayAuthDefaultPolicy = NDKRelayAuthPolicies.signIn({ndk: ndkInstance})
    ndkInstance.connect()
  } else if (opts) {
    throw new Error("NDK instance already initialized, cannot pass options")
  }
  return ndkInstance
}

function watchLocalSettings(instance: NDK) {
  useUserStore.subscribe((state, prevState) => {
    if (state.privateKey !== prevState.privateKey) {
      const havePrivateKey = state.privateKey && typeof state.privateKey === "string"
      if (!privateKeySigner && havePrivateKey) {
        try {
          privateKeySigner = new NDKPrivateKeySigner(state.privateKey)
          instance.signer = privateKeySigner
        } catch (e) {
          console.error("Error setting private key signer:", e)
        }
      } else if (!havePrivateKey && privateKeySigner) {
        privateKeySigner = undefined
        instance.signer = undefined
      }
    }
    
    if (state.nip07Login !== prevState.nip07Login) {
      if (state.nip07Login) {
        nip07Signer = new NDKNip07Signer()
        instance.signer = nip07Signer
        nip07Signer.user().then((user) => {
          useUserStore.getState().setPublicKey(user.pubkey)
        })
      } else if (nip07Signer) {
        nip07Signer = undefined
        instance.signer = privateKeySigner
      }
    }
    
    if (state.relays !== prevState.relays) {
      if (Array.isArray(state.relays)) {
        state.relays.forEach((url) => {
          if (!instance.pool.relays.has(url)) {
            instance.pool.addRelay(new NDKRelay(url, undefined, instance))
          }
        })
        for (const url of instance.pool.relays.keys()) {
          if (!state.relays.includes(url)) {
            instance.pool.removeRelay(url)
          }
        }
      }
    }
    
    if (state.publicKey !== prevState.publicKey) {
      instance.activeUser = state.publicKey
        ? new NDKUser({hexpubkey: state.publicKey})
        : undefined
    }
  })
}

/**
 * Create a new account (keypair), login with it and publish a profile event with the given name
 * @param name
 */
export function newUserLogin(name: string) {
  ndk()
  const sk = generateSecretKey() // `sk` is a Uint8Array
  const pk = getPublicKey(sk) // `pk` is a hex string
  const privateKeyHex = bytesToHex(sk)
  
  const store = useUserStore.getState()
  store.setPrivateKey(privateKeyHex)
  store.setPublicKey(pk)
  
  privateKeySigner = new NDKPrivateKeySigner(privateKeyHex)
  ndkInstance!.signer = privateKeySigner
  const profileEvent = new NDKEvent(ndkInstance!)
  profileEvent.kind = 0
  profileEvent.content = JSON.stringify({name})
  profileEvent.publish()
}

/**
 * Login with a private key
 * @param privateKey - hex or nsec format
 */
export function privateKeyLogin(privateKey: string) {
  ndk()
  if (privateKey && typeof privateKey === "string") {
    const bytes =
      privateKey.indexOf("nsec1") === 0
        ? (nip19.decode(privateKey).data as Uint8Array)
        : hexToBytes(privateKey)
    const hex = bytesToHex(bytes)
    privateKeySigner = new NDKPrivateKeySigner(hex)
    ndkInstance!.signer = privateKeySigner
    const publicKey = getPublicKey(bytes)
    
    const store = useUserStore.getState()
    store.setPrivateKey(hex)
    store.setPublicKey(publicKey)
  }
}
