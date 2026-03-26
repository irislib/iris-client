export function isShortUsernameSubscriptionUpsellEnabled(): boolean {
  return import.meta.env.VITE_ENABLE_SHORT_USERNAME_SUBSCRIPTION_UPSELL === "true"
}

export function shouldShowShortUsernameSubscriptionUpsell(errorMessage: string): boolean {
  return (
    isShortUsernameSubscriptionUpsellEnabled() &&
    errorMessage.toLowerCase().includes("must be")
  )
}
