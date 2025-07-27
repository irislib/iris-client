import {NavLink, Route, Routes, useLocation} from "react-router"
import {useMemo, ReactNode, useState, useEffect} from "react"
import {NostrEvent} from "nostr-tools"
import classNames from "classnames"

import RightColumn from "@/shared/components/RightColumn"
import PopularFeed from "@/shared/components/feed/PopularFeed"
import Feed from "@/shared/components/feed/Feed.tsx"
import {shouldHideAuthor} from "@/utils/visibility"
import Widget from "@/shared/components/ui/Widget"
import useFollows from "@/shared/hooks/useFollows"
import {hasMedia} from "@/shared/components/embed"
import {PublicKey} from "@/shared/utils/PublicKey"
import FollowList from "./components/FollowList"
import {getEventReplyingTo} from "@/utils/nostr"
import socialGraph from "@/utils/socialGraph"
import ProfileHeader from "./ProfileHeader"
import {useUserStore} from "@/stores/user"
import {subscribe} from "@/utils/applesauce"

type Tab = {
  name: string
  path: string
  element: ({
    pubKey,
    myPubKey,
    showRepliedTo,
    displayFilterFn,
  }: {
    pubKey: string
    myPubKey: string
    showRepliedTo?: boolean
    displayFilterFn?: (e: NostrEvent) => boolean
  }) => ReactNode
  displayFilterFn?: (e: NostrEvent) => boolean
  showRepliedTo?: boolean
}

const tabs: Tab[] = [
  {
    name: "Posts",
    path: "",
    displayFilterFn: (e: NostrEvent) => !getEventReplyingTo(e),
    element: ({pubKey, displayFilterFn}) => (
      <Feed
        key={`feed-${pubKey}`}
        filters={{kinds: [1, 6], authors: [pubKey]}}
        displayFilterFn={displayFilterFn}
        borderTopFirst={true}
        showEventsByUnknownUsers={true}
      />
    ),
  },
  {
    name: "Market",
    path: "market",
    element: ({pubKey}) => (
      <Feed
        key={`feed-${pubKey}`}
        filters={{kinds: [30402], authors: [pubKey]}}
        borderTopFirst={true}
        showRepliedTo={true}
        showEventsByUnknownUsers={true}
      />
    ),
  },
  {
    name: "Replies",
    path: "replies",
    element: ({pubKey}) => (
      <Feed
        key={`feed-${pubKey}`}
        filters={{kinds: [1, 6], authors: [pubKey]}}
        showRepliedTo={true}
        borderTopFirst={true}
        showEventsByUnknownUsers={true}
      />
    ),
  },
  {
    name: "Media",
    path: "media",
    displayFilterFn: (e: NostrEvent) => hasMedia(e),
    element: ({pubKey, displayFilterFn}) => (
      <Feed
        key={`feed-${pubKey}`}
        filters={{kinds: [1, 6], authors: [pubKey]}}
        displayFilterFn={displayFilterFn}
        borderTopFirst={true}
        showEventsByUnknownUsers={true}
      />
    ),
  },
  {
    name: "Likes",
    path: "likes",
    element: ({pubKey}) => (
      <Feed
        key={`feed-${pubKey}`}
        filters={{kinds: [7], authors: [pubKey]}}
        borderTopFirst={true}
        showEventsByUnknownUsers={true}
      />
    ),
  },
  {
    name: "You",
    path: "you",
    element: ({pubKey, myPubKey}) => (
      <Feed
        key={`feed-${pubKey}`}
        filters={{kinds: [1, 6, 7], authors: [pubKey], "#p": [myPubKey]}}
        borderTopFirst={true}
        showRepliedTo={true}
        showEventsByUnknownUsers={true}
      />
    ),
  },
]

function useHasMarketEvents(pubKey: string) {
  const [hasMarketEvents, setHasMarketEvents] = useState(false)

  useEffect(() => {
    if (!pubKey) return

    // Reset state when pubKey changes
    setHasMarketEvents(false)

    const sub = subscribe({
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
  const follows = useFollows(pubKey)
  const hasMarketEvents = useHasMarketEvents(pubKeyHex)
  const filteredFollows = useMemo(() => {
    return follows
      .filter((follow) => socialGraph().getFollowDistance(follow) > 1)
      .sort(() => Math.random() - 0.5) // Randomize order
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
                    <tab.element
                      showRepliedTo={tab.showRepliedTo}
                      pubKey={pubKeyHex}
                      displayFilterFn={tab.displayFilterFn}
                      myPubKey={myPubKey}
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
                <PopularFeed />
              </Widget>
            )}
          </>
        )}
      </RightColumn>
    </div>
  )
}

export default UserPage
