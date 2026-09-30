import {nip05VerificationCache} from "@/utils/memcache"
import {useEffect, useState} from "react"
import {nostr} from "@/utils/nostrClient"

export function useNip05Validation(pubkey: string, nip05?: string) {
  const [isValid, setIsValid] = useState<boolean | null>(null)

  useEffect(() => {
    if (!pubkey || !nip05) {
      setIsValid(null)
      return
    }

    const cacheKey = `${pubkey}:${nip05}`
    const cachedResult = nip05VerificationCache.get(cacheKey)

    // Only use cached result if it's a boolean (true/false), not null
    if (cachedResult !== undefined && cachedResult !== null) {
      setIsValid(cachedResult)
      return
    }

    // Start validation
    nostr()
      .getUser({hexpubkey: pubkey})
      ?.validateNip05(nip05)
      .then((result) => {
        const validationResult = result ?? false
        nip05VerificationCache.set(cacheKey, validationResult)
        setIsValid(validationResult)
      })
      .catch((error) => {
        console.warn("NIP-05 validation error:", error)
        setIsValid(false)
      })
  }, [pubkey, nip05])

  return isValid
}
