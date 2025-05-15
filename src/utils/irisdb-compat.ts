/**
 * Compatibility layer between zustand and irisdb's localState
 * This allows the chat module to continue using localState without modification
 * while the rest of the application uses zustand.
 */
import {localState} from "irisdb/src"
import {useUserStore} from "@/stores/user"

function setupLocalStateToZustandSync() {
  localState.get("user/publicKey").on((value) => {
    if (value && typeof value === "string" && value !== useUserStore.getState().publicKey) {
      console.log("Syncing publicKey from localState to zustand:", value)
      useUserStore.getState().setPublicKey(value)
    }
  })
  
  localState.get("user/privateKey").on((value) => {
    if (value && typeof value === "string" && value !== useUserStore.getState().privateKey) {
      console.log("Syncing privateKey from localState to zustand")
      useUserStore.getState().setPrivateKey(value)
    }
  })
  
  localState.get("user/nip07Login").on((value) => {
    if (typeof value === "boolean" && value !== useUserStore.getState().nip07Login) {
      console.log("Syncing nip07Login from localState to zustand:", value)
      useUserStore.getState().setNip07Login(value)
    }
  })
  
  localState.get("user/relays").on((value) => {
    if (Array.isArray(value) && JSON.stringify(value) !== JSON.stringify(useUserStore.getState().relays)) {
      console.log("Syncing relays from localState to zustand:", value)
      useUserStore.getState().setRelays(value as string[])
    }
  })
  
  localState.get("user/mediaserver").on((value) => {
    if (typeof value === "string" && value !== useUserStore.getState().mediaserver) {
      console.log("Syncing mediaserver from localState to zustand:", value)
      useUserStore.getState().setMediaserver(value)
    }
  })
  
  localState.get("user/walletConnect").on((value) => {
    if (typeof value === "boolean" && value !== useUserStore.getState().walletConnect) {
      console.log("Syncing walletConnect from localState to zustand:", value)
      useUserStore.getState().setWalletConnect(value)
    }
  })
  
  localState.get("user/cashuEnabled").on((value) => {
    if (typeof value === "boolean" && value !== useUserStore.getState().cashuEnabled) {
      console.log("Syncing cashuEnabled from localState to zustand:", value)
      useUserStore.getState().setCashuEnabled(value)
    }
  })
  
  localState.get("user/defaultZapAmount").on((value) => {
    if (typeof value === "number" && value !== useUserStore.getState().defaultZapAmount) {
      console.log("Syncing defaultZapAmount from localState to zustand:", value)
      useUserStore.getState().setDefaultZapAmount(value)
    }
  })
}

export function initializeCompatibilityLayer() {
  console.log("Initializing compatibility layer between zustand and irisdb")
  
  const userState = useUserStore.getState()
  
  // Ensure compatibility with chat module by syncing state to localState
  localState.get("user/publicKey").put(userState.publicKey)
  localState.get("user/privateKey").put(userState.privateKey)
  localState.get("user/nip07Login").put(userState.nip07Login)
  localState.get("user/relays").put(userState.relays)
  localState.get("user/mediaserver").put(userState.mediaserver)
  localState.get("user/walletConnect").put(userState.walletConnect)
  localState.get("user/cashuEnabled").put(userState.cashuEnabled)
  localState.get("user/defaultZapAmount").put(userState.defaultZapAmount)
  
  setupLocalStateToZustandSync()
  
  // Subscribe to zustand changes to update localState
  useUserStore.subscribe((state, prevState) => {
    if (state.publicKey !== prevState.publicKey) {
      console.log("Syncing publicKey from zustand to localState:", state.publicKey)
      localState.get("user/publicKey").put(state.publicKey)
    }
    
    if (state.privateKey !== prevState.privateKey) {
      console.log("Syncing privateKey from zustand to localState")
      localState.get("user/privateKey").put(state.privateKey)
    }
    
    if (state.nip07Login !== prevState.nip07Login) {
      console.log("Syncing nip07Login from zustand to localState:", state.nip07Login)
      localState.get("user/nip07Login").put(state.nip07Login)
    }
    
    if (state.relays !== prevState.relays) {
      console.log("Syncing relays from zustand to localState:", state.relays)
      localState.get("user/relays").put(state.relays)
    }
    
    if (state.mediaserver !== prevState.mediaserver) {
      console.log("Syncing mediaserver from zustand to localState:", state.mediaserver)
      localState.get("user/mediaserver").put(state.mediaserver)
    }
    
    if (state.walletConnect !== prevState.walletConnect) {
      console.log("Syncing walletConnect from zustand to localState:", state.walletConnect)
      localState.get("user/walletConnect").put(state.walletConnect)
    }
    
    if (state.cashuEnabled !== prevState.cashuEnabled) {
      console.log("Syncing cashuEnabled from zustand to localState:", state.cashuEnabled)
      localState.get("user/cashuEnabled").put(state.cashuEnabled)
    }
    
    if (state.defaultZapAmount !== prevState.defaultZapAmount) {
      console.log("Syncing defaultZapAmount from zustand to localState:", state.defaultZapAmount)
      localState.get("user/defaultZapAmount").put(state.defaultZapAmount)
    }
  })
}
