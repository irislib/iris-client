import {useMemo, useState, useEffect} from "react"
import classNames from "classnames"
import {RiMenuLine} from "@remixicon/react"

import RightColumn from "@/shared/components/RightColumn"
import AlgorithmicFeed from "@/shared/components/feed/AlgorithmicFeed"
import Feed from "@/shared/components/feed/Feed.tsx"
import Header from "@/shared/components/header/Header"
import {ScrollablePageContainer} from "@/shared/components/layout/ScrollablePageContainer"
import {Name} from "@/shared/components/user/Name"
import {Link} from "@/navigation"
import {type FeedConfig, useFeedStore} from "@/stores/feed"
import Widget from "@/shared/components/ui/Widget"
import useFollows from "@/shared/hooks/useFollows"
import {PublicKey} from "@/shared/utils/PublicKey"
import FollowList from "./components/FollowList"
import {useSocialGraph} from "@/utils/socialGraph"
import ProfileHeader from "./ProfileHeader"
import ProfileDropdownButton from "@/shared/components/user/ProfileDropdownButton"
import {useUserStore} from "@/stores/user"
import {ndk} from "@/utils/ndk"
import {SocialGraphWidget} from "@/shared/components/SocialGraphWidget"
import {
  KIND_TEXT_NOTE,
  KIND_REPOST,
  KIND_REACTION,
  KIND_CLASSIFIED,
  KIND_PICTURE_FIRST,
  KIND_ZAP_RECEIPT,
  KIND_LONG_FORM_CONTENT,
} from "@/utils/constants"

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
      id: `profile-posts`,
      hideReplies: true,
      showEventsByUnknownUsers: true,
      filter: {
        kinds: [KIND_TEXT_NOTE, KIND_REPOST, KIND_PICTURE_FIRST],
        authors: [pubKey],
      },
    }),
  },
  {
    name: "Articles",
    path: "articles",
    getFeedConfig: (pubKey) => ({
      name: "Articles",
      id: `profile-articles`,
      showEventsByUnknownUsers: true,
      filter: {kinds: [KIND_LONG_FORM_CONTENT], authors: [pubKey]},
    }),
  },
  {
    name: "Market",
    path: "market",
    getFeedConfig: (pubKey) => ({
      name: "Market",
      id: `profile-market`,
      showEventsByUnknownUsers: true,
      filter: {kinds: [KIND_CLASSIFIED], authors: [pubKey]},
      showRepliedTo: true,
    }),
  },
  {
    name: "Replies",
    path: "replies",
    getFeedConfig: (pubKey) => ({
      name: "Replies",
      id: `profile-replies`,
      showEventsByUnknownUsers: true,
      filter: {
        kinds: [KIND_TEXT_NOTE, KIND_REPOST, KIND_PICTURE_FIRST],
        authors: [pubKey],
      },
      showRepliedTo: true,
    }),
  },
  {
    name: "Media",
    path: "media",
    getFeedConfig: (pubKey) => ({
      name: "Media",
      id: `profile-media`,
      requiresMedia: true,
      showEventsByUnknownUsers: true,
      filter: {
        kinds: [KIND_TEXT_NOTE, KIND_REPOST, KIND_PICTURE_FIRST],
        authors: [pubKey],
      },
    }),
  },
  {
    name: "Likes",
    path: "likes",
    getFeedConfig: (pubKey) => ({
      name: "Likes",
      id: `profile-likes`,
      showEventsByUnknownUsers: true,
      filter: {kinds: [KIND_REACTION], authors: [pubKey]},
    }),
  },
  {
    name: "You",
    path: "you",
    getFeedConfig: (pubKey, myPubKey) => ({
      name: "You",
      id: `profile-you`,
      showEventsByUnknownUsers: true,
      filter: {
        kinds: [KIND_TEXT_NOTE, KIND_REPOST, KIND_REACTION, KIND_PICTURE_FIRST],
        authors: [pubKey],
        "#p": [myPubKey],
      },
      showRepliedTo: true,
    }),
  },
  {
    name: "Zaps",
    path: "zaps",
    getFeedConfig: (pubKey) => ({
      name: "Zaps",
      id: `profile-zaps`,
      showEventsByUnknownUsers: true,
      showAuthorInZapReceipts: false,
      filter: {
        kinds: [KIND_ZAP_RECEIPT],
        "#P": [pubKey],
      },
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
      kinds: [KIND_CLASSIFIED],
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

function useHasArticles(pubKey: string) {
  const [hasArticles, setHasArticles] = useState(false)

  useEffect(() => {
    if (!pubKey) return

    setHasArticles(false)

    const sub = ndk().subscribe({
      kinds: [KIND_LONG_FORM_CONTENT],
      authors: [pubKey],
      limit: 1,
    })

    sub.on("event", () => {
      setHasArticles(true)
      sub.stop()
    })

    return () => {
      sub.stop()
    }
  }, [pubKey])

  return hasArticles
}

function UserPage({pubKey}: {pubKey: string}) {
  const socialGraph = useSocialGraph()
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
  const {loadFeedConfig} = useFeedStore()
  const follows = useFollows(pubKey)
  const hasMarketEvents = useHasMarketEvents(pubKeyHex)
  const hasArticles = useHasArticles(pubKeyHex)
  const [activeTab, setActiveTab] = useState("")

  // Check if this is the user's own profile
  const isOwnProfile = myPubKey === pubKeyHex

  const filteredFollows = useMemo(() => {
    const filtered = myPubKey
      ? follows.filter((follow) => socialGraph.getFollowDistance(follow) > 1)
      : follows
    return filtered.sort(() => Math.random() - 0.5) // Randomize order
  }, [follows, myPubKey, socialGraph])

  const visibleTabs = tabs.filter(
    (tab) =>
      (tab.path !== "you" || (myPubKey && !isOwnProfile)) &&
      (tab.path !== "articles" || hasArticles || activeTab === "articles") &&
      (tab.path !== "market" || hasMarketEvents || activeTab === "market")
  )

  return (
    <div className="flex justify-center flex-1 relative h-full">
      <div className="flex-1 flex flex-col h-full relative min-w-0 overflow-hidden">
        <Header
          rightContent={
            <div className="flex items-center gap-2">
              {isOwnProfile ? (
                <Link
                  to="/settings"
                  className="btn btn-ghost btn-circle md:hidden"
                  title="Settings"
                >
                  <RiMenuLine className="w-7 h-7" />
                </Link>
              ) : (
                <ProfileDropdownButton pubKey={pubKeyHex} />
              )}
            </div>
          }
        >
          <Name pubKey={pubKeyHex} />
        </Header>
        <ScrollablePageContainer>
          <div className="flex-1">
            <div className="flex flex-1 flex-col items-center">
              <ProfileHeader pubKey={pubKey} key={pubKey} showHeader={false} />
              <div className="flex w-full flex-1 mt-2 flex-col gap-4">
                <div className="px-4 flex gap-2 overflow-x-auto max-w-[100vw] scrollbar-hide">
                  {visibleTabs.map((tab) => (
                    <button
                      key={tab.path}
                      onClick={(e) => {
                        e.preventDefault()
                        setActiveTab(tab.path)
                      }}
                      className={classNames(
                        "btn btn-sm",
                        activeTab === tab.path ? "btn-primary" : "btn-neutral"
                      )}
                    >
                      {tab.name}
                    </button>
                  ))}
                </div>
                {(() => {
                  const activeTabConfig =
                    visibleTabs.find((tab) => tab.path === activeTab) || visibleTabs[0]

                  const baseFeedConfig = activeTabConfig.getFeedConfig(
                    pubKeyHex,
                    myPubKey
                  )
                  const savedConfig = loadFeedConfig(baseFeedConfig.id)
                  const feedConfig = {
                    ...baseFeedConfig,
                    displayAs: savedConfig?.displayAs,
                  }

                  return (
                    <Feed
                      key={`feed-${pubKeyHex}-${activeTabConfig.path}`}
                      feedConfig={feedConfig}
                      borderTopFirst={true}
                    />
                  )
                })()}
              </div>
            </div>
          </div>
        </ScrollablePageContainer>
      </div>
      <RightColumn>
        {() => (
          <>
            {filteredFollows.length > 0 && (
              <Widget title="Follows" className="h-96">
                <FollowList follows={filteredFollows} />
              </Widget>
            )}
            {pubKeyHex === myPubKey && (
              <>
                <SocialGraphWidget />
                <Widget title="Popular" className="h-96">
                  <AlgorithmicFeed
                    type="popular"
                    displayOptions={{
                      small: true,
                      showDisplaySelector: false,
                    }}
                  />
                </Widget>
              </>
            )}
          </>
        )}
      </RightColumn>
    </div>
  )
}

export default UserPage
