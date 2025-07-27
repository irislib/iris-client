import SignUp from "@/shared/components/user/SignUp"
import SignIn from "@/shared/components/user/SignIn"
import {useState} from "react"
import {CONFIG} from "@/utils/config"

export default function LoginDialog() {
  const [showSignIn, setShowSignIn] = useState(!!window.nostr)

  return (
    <div className="flex flex-row items-center gap-2 justify-between card card-compact">
      <div className="card-body items-center">
        <img
          src={String(CONFIG.navLogo)}
          alt={String(CONFIG.appName)}
          className="w-12 h-12"
        />
        {showSignIn ? (
          <SignIn onClose={() => setShowSignIn(false)} />
        ) : (
          <SignUp onClose={() => setShowSignIn(true)} />
        )}
      </div>
    </div>
  )
}
