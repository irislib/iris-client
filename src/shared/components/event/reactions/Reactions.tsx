import Reposts from "@/shared/components/event/reactions/Reposts.tsx"
import Likes from "@/shared/components/event/reactions/Likes.tsx"
import Zaps from "@/shared/components/event/reactions/Zaps.tsx"
import {AppEvent} from "@/lib/nostr"
import {useState} from "react"
import {Avatar} from "@/shared/components/user/Avatar"
import {Name} from "@/shared/components/user/Name"

export default function Reactions({event}: {event: AppEvent}) {
  const [activeTab, setActiveTab] = useState("likes")

  return (
    <div className="flex flex-col gap-2 w-full md:w-96 h-full">
      <div className="flex items-center gap-3 mb-4">
        <Avatar pubKey={event.pubkey} width={40} showBadge={false} />
        <div className="flex flex-col">
          <span className="text-sm opacity-70">Reactions to post by</span>
          <Name pubKey={event.pubkey} className="font-semibold" />
        </div>
      </div>
      <div className="tabs">
        <button
          className={`tab border-b ${activeTab === "likes" ? "border-primary" : "border-transparent"}`}
          onClick={() => setActiveTab("likes")}
        >
          Likes
        </button>
        <button
          className={`tab border-b ${activeTab === "reposts" ? "border-primary" : "border-transparent"}`}
          onClick={() => setActiveTab("reposts")}
        >
          Reposts
        </button>
        <button
          className={`tab border-b ${activeTab === "zaps" ? "border-primary" : "border-transparent"}`}
          onClick={() => setActiveTab("zaps")}
        >
          Zaps
        </button>
      </div>
      <div className="flex-1 overflow-auto pt-4">
        {activeTab === "likes" && <Likes event={event} />}
        {activeTab === "reposts" && <Reposts event={event} />}
        {activeTab === "zaps" && <Zaps event={event} />}
      </div>
    </div>
  )
}
