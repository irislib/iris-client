import Reposts from "@/shared/components/event/reactions/Reposts.tsx"
import Likes from "@/shared/components/event/reactions/Likes.tsx"
import Zaps from "@/shared/components/event/reactions/Zaps.tsx"
import {NostrEvent} from "nostr-tools"
import {useState} from "react"

export default function Reactions({event}: {event: NostrEvent}) {
  const [activeTab, setActiveTab] = useState("likes")

  return (
    <div className="flex flex-col gap-2 w-96 max-w-full">
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
      <div className="h-[600px] overflow-auto pt-4">
        {activeTab === "likes" && <Likes event={event} />}
        {activeTab === "reposts" && <Reposts event={event} />}
        {activeTab === "zaps" && <Zaps event={event} />}
      </div>
    </div>
  )
}
