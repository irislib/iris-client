import {NavLink, Route, Routes, useLocation} from "react-router"
import {useMemo, useState, useEffect} from "react"
import classNames from "classnames"

import RightColumn from "@/shared/components/RightColumn"
import PopularFeed from "@/shared/components/feed/PopularFeed"
import Feed from "@/shared/components/feed/Feed.tsx"
import {type FeedConfig} from "@/stores/feed"
import {shouldHideAuthor} from "@/utils/visibility"
import Widget from "@/shared/components/ui/Widget"
import useFollows from "@/shared/hooks/useFollows"
import {PublicKey} from "@/shared/utils/PublicKey"
import FollowList from "./components/FollowList"
import socialGraph from "@/utils/socialGraph"
import ProfileHeader from "./ProfileHeader"
import {useUserStore} from "@/stores/user"
import {ndk} from "@/utils/ndk"

type Tab = {
  name: string
  path: string
  getFeedConfig: (pubKey: string, myPubKey: string) => FeedConfig
}

const tabs: Tab[] = [
  {
    name: "Posts",
    path: "",
    getFeedConfig: (pubKey) => ({
      name: "Posts",
      id: `posts-${pubKey}`,
      hideReplies: true,
      showEventsByUnknownUsers: true,
      filter: {kinds: [1, 6], authors: [pubKey]},
    }),
  },
  {
    name: "Market",
    path: "market",
    getFeedConfig: (pubKey) => ({
      name: "Market",
      id: `market-${pubKey}`,
      showEventsByUnknownUsers: true,
      filter: {kinds: [30402], authors: [pubKey]},
      showRepliedTo: true,
    }),
  },
  {
    name: "Replies",
    path: "replies",
    getFeedConfig: (pubKey) => ({
      name: "Replies",
      id: `replies-${pubKey}`,
      showEventsByUnknownUsers: true,
      filter: {kinds: [1, 6], authors: [pubKey]},
      showRepliedTo: true,
    }),
  },
  {
    name: "Media",
    path: "media",
    getFeedConfig: (pubKey) => ({
      name: "Media",
      id: `media-${pubKey}`,
      requiresMedia: true,
      showEventsByUnknownUsers: true,
      filter: {kinds: [1, 6], authors: [pubKey]},
    }),
  },
  {
    name: "Likes",
    path: "likes",
    getFeedConfig: (pubKey) => ({
      name: "Likes",
      id: `likes-${pubKey}`,
      showEventsByUnknownUsers: true,
      filter: {kinds: [7], authors: [pubKey]},
    }),
  },
  {
    name: "You",
    path: "you",
    getFeedConfig: (pubKey, myPubKey) => ({
      name: "You",
      id: `you-${pubKey}`,
      showEventsByUnknownUsers: true,
      filter: {kinds: [1, 6, 7], authors: [pubKey], "#p": [myPubKey]},
      showRepliedTo: true,
    }),
  },
]

function useHasMarketEvents(pubKey: string) {
  const [hasMarketEvents, setHasMarketEvents] = useState(false)

  useEffect(() => {
    if (!pubKey) return

    // Reset state when pubKey changes
    setHasMarketEvents(false)

    const sub = ndk().subscribe({
      kinds: [30402],
      authors: [pubKey],
      limit: 1,
    })

    sub.on("event", () => {
      setHasMarketEvents(true)
      sub.stop()
    })

    return () => {
      sub.stop()
    }
  }, [pubKey])

  return hasMarketEvents
}

function UserPage({pubKey}: {pubKey: string}) {
  if (typeof pubKey !== "string") {
    throw new Error(
      "pubKey must be a string, received: " + typeof pubKey + " " + JSON.stringify(pubKey)
    )
  }
  const pubKeyHex = useMemo(
    () => (pubKey ? new PublicKey(pubKey).toString() : ""),
    [pubKey]
  )
  const myPubKey = useUserStore((state) => state.publicKey)
  console.log("myPubKey", myPubKey)
  console.log("pubKeyHex", pubKeyHex)
  const follows = useFollows(pubKey)
  const hasMarketEvents = useHasMarketEvents(pubKeyHex)
  const filteredFollows = useMemo(() => {
    const filtered = myPubKey
      ? follows.filter((follow) => socialGraph().getFollowDistance(follow) > 1)
      : follows
    return filtered.sort(() => Math.random() - 0.5) // Randomize order
  }, [follows])
  const location = useLocation()
  const activeProfile = location.pathname.split("/")[1] || ""

  const visibleTabs = tabs.filter(
    (tab) =>
      (tab.path !== "you" || (myPubKey && !shouldHideAuthor(pubKeyHex))) &&
      (tab.path !== "market" || hasMarketEvents || location.pathname.includes("/market"))
  )

  return (
    <div className="flex flex-1 justify-center">
      <div className="flex flex-1 justify-center">
        <div className="flex flex-1 flex-col items-center justify-center h-full">
          <ProfileHeader pubKey={pubKey} key={pubKey} />
          <div className="flex w-full flex-1 mt-2 flex flex-col gap-4">
            <div className="px-4 flex gap-2 overflow-x-auto max-w-[100vw] scrollbar-hide">
              {visibleTabs.map((tab) => (
                <NavLink
                  key={tab.path}
                  to={`/${activeProfile}${tab.path ? `/${tab.path}` : ""}`}
                  end={tab.path === ""}
                  replace={true}
                  preventScrollReset={true}
                  className={({isActive}) =>
                    classNames("btn btn-sm", isActive ? "btn-primary" : "btn-neutral")
                  }
                >
                  {tab.name}
                </NavLink>
              ))}
            </div>
            <Routes>
              {visibleTabs.map((tab) => (
                <Route
                  key={tab.path}
                  path={tab.path}
                  element={
                    <Feed
                      key={`feed-${pubKeyHex}-${tab.path}`}
                      feedConfig={tab.getFeedConfig(pubKeyHex, myPubKey)}
                      borderTopFirst={true}
                    />
                  }
                />
              ))}
            </Routes>
          </div>
        </div>
      </div>
      <RightColumn>
        {() => (
          <>
            {filteredFollows.length > 0 && (
              <Widget title="Follows">
                <FollowList follows={filteredFollows} />
              </Widget>
            )}
            {pubKeyHex === myPubKey && (
              <Widget title="Popular">
                <PopularFeed displayOptions={{small: true, showDisplaySelector: false}} />
              </Widget>
            )}
          </>
        )}
      </RightColumn>
    </div>
  )
}

export default UserPage
