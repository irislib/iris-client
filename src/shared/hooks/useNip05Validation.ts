import {nip05VerificationCache} from "@/utils/memcache"
import {useEffect, useState} from "react"

export function useNip05Validation(pubkey: string, nip05?: string) {
  const [isValid, setIsValid] = useState<boolean | null>(null)

  useEffect(() => {
    if (!pubkey || !nip05) {
      setIsValid(null)
      return
    }

    const cacheKey = `${pubkey}:${nip05}`
    const cachedResult = nip05VerificationCache.get(cacheKey)

    if (cachedResult !== undefined) {
      setIsValid(cachedResult)
      return
    }

    // TODO: Implement actual NIP-05 validation using nostr-tools
    // For now, always return false (same as NDK compat layer was doing)
    const validationResult = false
    nip05VerificationCache.set(cacheKey, validationResult)
    setIsValid(validationResult)
  }, [pubkey, nip05])

  return isValid
}
