/**
 * Hook to handle blossom URLs
 * @param url - The blossom URL
 * @param authorPubkey - Optional pubkey of the post author (unused, kept for API compatibility)
 */
export function useBlossomCache(url: string, _authorPubkey?: string): string {
  return url
}
