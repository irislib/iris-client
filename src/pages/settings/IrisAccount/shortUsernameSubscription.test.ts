import {afterEach, describe, expect, it, vi} from "vitest"
import {shouldShowShortUsernameSubscriptionUpsell} from "./shortUsernameSubscription"

describe("shouldShowShortUsernameSubscriptionUpsell", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("is disabled by default for username length errors", () => {
    expect(
      shouldShowShortUsernameSubscriptionUpsell(
        "Username must be between 8 and 15 characters"
      )
    ).toBe(false)
  })

  it("stays hidden for unrelated errors even when the flag is enabled", () => {
    vi.stubEnv("VITE_ENABLE_SHORT_USERNAME_SUBSCRIPTION_UPSELL", "true")

    expect(
      shouldShowShortUsernameSubscriptionUpsell("This username is not available")
    ).toBe(false)
  })

  it("is shown for username length errors when the flag is enabled", () => {
    vi.stubEnv("VITE_ENABLE_SHORT_USERNAME_SUBSCRIPTION_UPSELL", "true")

    expect(
      shouldShowShortUsernameSubscriptionUpsell(
        "Username must be between 8 and 15 characters"
      )
    ).toBe(true)
  })
})
