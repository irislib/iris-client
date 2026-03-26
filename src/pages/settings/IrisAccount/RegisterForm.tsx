import {SubscriberBadge} from "@/shared/components/user/SubscriberBadge"
import {FormEvent, useState, ChangeEvent} from "react"
import {useUserStore} from "@/stores/user"
import AccountName from "./AccountName"
import {Link} from "@/navigation"
import {SettingsGroup} from "@/shared/components/settings/SettingsGroup"
import {SettingsGroupItem} from "@/shared/components/settings/SettingsGroupItem"
import {createDebugLogger} from "@/utils/createDebugLogger"
import {DEBUG_NAMESPACES} from "@/utils/constants"
import {shouldShowShortUsernameSubscriptionUpsell} from "./shortUsernameSubscription"

const {log, error} = createDebugLogger(DEBUG_NAMESPACES.UTILS)

interface RegisterFormProps {
  minLength: number
  subscriptionPlan: string | null
  onRegister: (username: string) => void
}

function RegisterForm({minLength, subscriptionPlan, onRegister}: RegisterFormProps) {
  const [username, setUsername] = useState("")
  const [isValid, setIsValid] = useState(false)
  const [errorMessage, setErrorMessage] = useState("")
  const [isChecking, setIsChecking] = useState(false)
  const [statusMessage, setStatusMessage] = useState("")
  const pubKey = useUserStore.getState().publicKey

  const handleInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    const name = e.target.value
    setUsername(name)
    setIsValid(false)
    setStatusMessage("")

    if (!name) {
      setErrorMessage("")
      return
    }

    // Length check
    if (name.length < minLength || name.length > 15) {
      setErrorMessage(`Username must be between ${minLength} and 15 characters`)
      return
    }

    // Format check
    if (!name.match(/^[a-z0-9_.]+$/)) {
      setErrorMessage(
        "Username must only contain lowercase letters, numbers, underscores and dots"
      )
      return
    }

    setErrorMessage("")
    checkAvailability(name)
  }

  const checkAvailability = async (name: string) => {
    setIsChecking(true)
    setStatusMessage("Checking availability...")
    setErrorMessage("")

    try {
      log(`Checking availability for: ${name}`)
      const url = `${CONFIG.defaultSettings.irisApiUrl}/user/available?name=${encodeURIComponent(name)}&public_key=${pubKey}`

      const response = await fetch(url)
      const text = await response.text()
      log(`API response (${response.status}): ${text}`)

      try {
        const json = JSON.parse(text)
        log("Parsed JSON:", json)

        if (json.available === true) {
          log("Username IS available")
          setIsValid(true)
          setStatusMessage("Username is available")
          setErrorMessage("")
        } else {
          log("Username is NOT available")
          setIsValid(false)
          const message = json.message || "This username is not available"
          log(`Setting error message: "${message}"`)
          setErrorMessage(message)
          setStatusMessage("")
        }
      } catch (e) {
        error("Parse error:", e)
        setErrorMessage("Error parsing response")
        setStatusMessage("")
        setIsValid(false)
      }
    } catch (err) {
      error("Network error:", err)
      setErrorMessage("Network error checking username")
      setStatusMessage("")
      setIsValid(false)
    } finally {
      setIsChecking(false)
    }
  }

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (isValid) onRegister(username)
  }

  return (
    <>
      <SettingsGroup title="Subscription Status">
        <SettingsGroupItem isLast>
          <div className="flex flex-col gap-3">
            <SubscriberBadge pubkey={pubKey} />
            <div className="text-sm text-base-content/70">
              Current subscription:{" "}
              {subscriptionPlan
                ? `${subscriptionPlan} (min username length: ${minLength})`
                : "None"}
            </div>
          </div>
        </SettingsGroupItem>
      </SettingsGroup>

      <SettingsGroup title="Register Username">
        <SettingsGroupItem isLast>
          <div className="space-y-4">
            <div className="text-sm text-base-content/70">
              Register an Iris username (iris.to/username)
            </div>

            <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
              <div className="flex flex-row gap-2">
                <input
                  className="input input-bordered flex-1"
                  type="text"
                  placeholder="Username"
                  value={username}
                  onChange={handleInputChange}
                />
                <button
                  className="btn btn-primary"
                  type="submit"
                  disabled={!isValid || isChecking}
                >
                  {isChecking ? "Checking..." : "Register"}
                </button>
              </div>

              {/* Status messages */}
              <div className="space-y-2">
                {/* Checking status */}
                {isChecking && (
                  <div className="text-info text-sm">Checking availability...</div>
                )}

                {/* Valid username */}
                {!isChecking && isValid && statusMessage && (
                  <div className="text-success text-sm">
                    <div>{statusMessage}</div>
                    <div className="mt-2">
                      <AccountName name={username} link={false} />
                    </div>
                  </div>
                )}

                {/* Error message */}
                {errorMessage && <div className="text-error text-sm">{errorMessage}</div>}

                {/* Subscription upgrade link */}
                {shouldShowShortUsernameSubscriptionUpsell(errorMessage) && (
                  <div className="text-sm">
                    <Link to="/subscribe" className="link">
                      Get a subscription to choose shorter usernames
                    </Link>
                  </div>
                )}
              </div>
            </form>
          </div>
        </SettingsGroupItem>
      </SettingsGroup>
    </>
  )
}

export default RegisterForm
