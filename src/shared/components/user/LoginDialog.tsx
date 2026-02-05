import SignUp from "@/shared/components/user/SignUp"
import SignIn from "@/shared/components/user/SignIn"
import LinkDevice from "@/shared/components/user/LinkDevice"
import {useState} from "react"

export default function LoginDialog() {
  const [view, setView] = useState<"signin" | "signup" | "link">(
    window.nostr ? "signin" : "signup"
  )

  return (
    <div className="flex flex-row items-center gap-2 justify-between card card-compact min-w-[320px] max-w-[90vw]">
      <div className="card-body items-center">
        <img src={CONFIG.navLogo} alt={CONFIG.appName} className="w-12 h-12" />
        {view === "signin" && (
          <SignIn onClose={() => setView("signup")} onLink={() => setView("link")} />
        )}
        {view === "signup" && (
          <SignUp onClose={() => setView("signin")} onLink={() => setView("link")} />
        )}
        {view === "link" && <LinkDevice onBack={() => setView("signin")} />}
      </div>
    </div>
  )
}
