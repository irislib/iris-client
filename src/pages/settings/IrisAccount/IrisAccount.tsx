/* eslint-disable @typescript-eslint/no-explicit-any */
import {SubscriberBadge} from "@/shared/components/user/SubscriberBadge"
import {getMainThreadDb} from "@/lib/nostr/db"
import ActiveAccount from "./ActiveAccount"
import ChallengeForm from "./ChallengeForm"
import {useUserStore} from "@/stores/user"
import RegisterForm from "./RegisterForm"
import {useEffect, useState} from "react"
import AccountName from "./AccountName"
import IrisAPI from "@/utils/IrisAPI"
import {SettingsGroup} from "@/shared/components/settings/SettingsGroup"
import {SettingsGroupItem} from "@/shared/components/settings/SettingsGroupItem"
import {createDebugLogger} from "@/utils/createDebugLogger"
import {DEBUG_NAMESPACES} from "@/utils/constants"

const {log, error: logError} = createDebugLogger(DEBUG_NAMESPACES.UTILS)

// Main component
function IrisAccount() {
  const [irisToActive, setIrisToActive] = useState(false)
  const [existing, setExisting] = useState<any>(null)
  const [profile, setProfile] = useState<any>(null)
  const [error, setError] = useState<string | null>(null)
  const [showChallenge, setShowChallenge] = useState(false)
  const [pendingUsername, setPendingUsername] = useState("")
  const [subscriptionPlan, setSubscriptionPlan] = useState<string | null>(null)
  const [minUsernameLength, setMinUsernameLength] = useState(8)
  const [api] = useState(() => new IrisAPI())

  const myPubKey = useUserStore.getState().publicKey

  // Fetch user account data
  const checkExistingAccount = async (pub: string) => {
    if (!pub) return

    const url = `${CONFIG.defaultSettings.irisApiUrl}/user/find?public_key=${pub}&nocache=${Date.now()}`
    const res = await fetch(url)

    if (res.status === 200) {
      const json = await res.json()
      log("User data:", json)

      // Handle subscription data
      if (json.subscription_plan) {
        const plan = json.subscription_plan.toLowerCase()
        let minLength = 8

        if (plan.includes("vanguard")) minLength = 3
        else if (plan.includes("champion")) minLength = 5
        else if (plan.includes("patron")) minLength = 6

        setSubscriptionPlan(json.subscription_plan)
        setMinUsernameLength(minLength)
      } else {
        setSubscriptionPlan(null)
        setMinUsernameLength(8)
      }

      // Set existing username if available
      if (json.name) setExisting(json)
    }
  }

  // Handle registration
  const handleRegister = async (username: string) => {
    setPendingUsername(username)
    // Skip Cloudflare verification for users with active subscriptions
    if (subscriptionPlan) {
      await registerDirectly(username)
    } else {
      setShowChallenge(true)
    }
  }

  // Register directly without Cloudflare challenge for subscribers
  const registerDirectly = async (username: string) => {
    try {
      const response = await api.registerUsername(username)
      if (response.signed_up) {
        setError(null)
        setExisting({name: username})
      }
    } catch (err) {
      logError("Registration error:", err)
      setError("Error during registration")
    }
  }

  // Handle Cloudflare verification
  const handleVerify = async (cfToken: string) => {
    try {
      const response = await api.registerUsername(pendingUsername, cfToken)
      if (response.signed_up) {
        setError(null)
        setExisting({name: pendingUsername})
        setShowChallenge(false)
      }
    } catch (err) {
      logError("Verification error:", err)
      setError("Error during verification")
    }
  }

  // Setup effects
  useEffect(() => {
    // User store subscription handler
    const handleUserChange = async (state: any) => {
      const userPubKey = state.publicKey
      if (userPubKey && typeof userPubKey === "string") {
        const db = getMainThreadDb()
        const userProfile = await db.profiles.get(userPubKey)
        setProfile(userProfile || {})

        const isIrisToActive = Boolean(
          userProfile?.nip05 && userProfile.nip05.endsWith("@iris.to")
        )
        setIrisToActive(isIrisToActive)

        checkExistingAccount(userPubKey)
      }
    }

    // Setup subscriptions
    const unsubscribe = useUserStore.subscribe(handleUserChange)
    handleUserChange(useUserStore.getState())

    return () => {
      unsubscribe()
    }
  }, [])

  // Render based on state
  if (irisToActive) {
    return (
      <SettingsGroup title="Active Iris.to Username">
        <AccountName name={profile?.nip05?.split("@")[0]} />
        <SettingsGroupItem isLast>
          <SubscriberBadge pubkey={myPubKey} />
        </SettingsGroupItem>
      </SettingsGroup>
    )
  }

  if (existing) {
    return (
      <>
        <ActiveAccount name={existing.name} setAsPrimary={() => setIrisToActive(true)} />
        <SettingsGroup title="Subscription">
          <SettingsGroupItem isLast>
            <SubscriberBadge pubkey={myPubKey} />
          </SettingsGroupItem>
        </SettingsGroup>
      </>
    )
  }

  if (error) {
    return (
      <SettingsGroup title="Error">
        <SettingsGroupItem isLast>
          <div className="text-error">{error}</div>
        </SettingsGroupItem>
      </SettingsGroup>
    )
  }

  if (showChallenge) {
    return (
      <SettingsGroup title="Verification Required">
        <SettingsGroupItem isLast>
          <ChallengeForm onVerify={handleVerify} />
        </SettingsGroupItem>
      </SettingsGroup>
    )
  }

  return (
    <RegisterForm
      minLength={minUsernameLength}
      subscriptionPlan={subscriptionPlan}
      onRegister={handleRegister}
    />
  )
}

export default IrisAccount
