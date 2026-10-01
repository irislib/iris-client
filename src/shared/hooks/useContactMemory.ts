import {useUserStore} from "@/stores/user"
import {useContactMemoryStore} from "@/stores/contactMemory"

export function useContactMemory(pubkey: string) {
  const account = useUserStore((state) => state.publicKey)
  return useContactMemoryStore((state) => state.accounts[account]?.[pubkey])
}
