import FeedItem from "@/shared/components/event/FeedItem/FeedItem"
import RightColumn from "@/shared/components/RightColumn.tsx"
import AlgorithmicFeed from "@/shared/components/feed/AlgorithmicFeed"
import AuthorArticlesFeed from "@/shared/components/feed/AuthorArticlesFeed"
import FollowList from "@/pages/user/components/FollowList"
import Header from "@/shared/components/header/Header"
import {Name} from "@/shared/components/user/Name"
import Widget from "@/shared/components/ui/Widget"
import {useSettingsStore} from "@/stores/settings"
import socialGraph from "@/utils/socialGraph"
import {NDKEvent} from "@nostr-dev-kit/ndk"
import {useState, useEffect, useCallback} from "react"
import {getTags} from "@/utils/nostr"
import {nip19} from "nostr-tools"
import {KIND_LONG_FORM_CONTENT} from "@/utils/constants"
import {useLongformEvent} from "@/shared/hooks/useLongformEvent"

export default function ThreadPage({
  id,
  isNaddr = false,
  naddrData = null,
}: {
  id: string
  isNaddr?: boolean
  naddrData?: nip19.AddressPointer | null
}) {
  const [relevantPeople, setRelevantPeople] = useState(new Map<string, boolean>())
  const {content} = useSettingsStore()
  const [threadAuthor, setThreadAuthor] = useState<string | null>(null)
  const [isArticle, setIsArticle] = useState(false)

  // Use the custom hook for longform event caching
  const {event: longformEvent, loading: longformLoading} = useLongformEvent(
    isNaddr ? naddrData : null
  )
  const [event, setEvent] = useState<NDKEvent | null>(null)
  const [loading, setLoading] = useState(false)

  const addRelevantPerson = useCallback((person: string) => {
    setRelevantPeople((prev) => new Map(prev).set(person, true))
  }, [])

  useEffect(() => {
    setThreadAuthor(null)
  }, [id])

  // Handle longform event updates from the hook
  useEffect(() => {
    if (isNaddr && longformEvent) {
      setEvent(longformEvent)
      setLoading(longformLoading)
      if (longformEvent.pubkey) {
        setThreadAuthor(longformEvent.pubkey)
        addRelevantPerson(longformEvent.pubkey)
      }
      // Check if this is an article
      if (longformEvent.kind === KIND_LONG_FORM_CONTENT) {
        setIsArticle(true)
      }
    } else if (isNaddr) {
      setLoading(longformLoading)
    }
  }, [isNaddr, longformEvent, longformLoading, addRelevantPerson])

  const addToThread = useCallback(
    (event: NDKEvent) => {
      if (
        content.hideEventsByUnknownUsers &&
        socialGraph().getFollowDistance(event.pubkey) > 5
      )
        return
      if (!threadAuthor) setThreadAuthor(event.pubkey)
      // Check if this is an article (long-form content)
      if (event.kind === KIND_LONG_FORM_CONTENT) {
        setIsArticle(true)
      }
      addRelevantPerson(event.pubkey)
      for (const user of getTags("p", event.tags)) {
        addRelevantPerson(user)
      }
    },
    [content.hideEventsByUnknownUsers, threadAuthor, addRelevantPerson]
  )

  return (
    <div
      className="flex flex-col h-full overflow-y-scroll overflow-x-hidden"
      data-main-scroll-container="true"
    >
      <Header>
        {threadAuthor ? (
          <>
            Post by <Name className="-ml-3" pubKey={threadAuthor} />
          </>
        ) : (
          "Post"
        )}
      </Header>
      <div className="flex justify-center flex-1 relative">
        <div className="flex-1 pt-[calc(4rem+env(safe-area-inset-top))] pb-[calc(4rem+env(safe-area-inset-bottom))] md:pt-16 md:pb-0 max-w-full overflow-hidden">
          {(() => {
            if (isNaddr) {
              if (loading) {
                return (
                  <div className="flex relative flex-col pt-3 px-4 min-h-[186px] pb-0 transition-colors duration-200 ease-in-out border-custom cursor-pointer border-2 pt-3 pb-3 my-2 rounded hover:bg-[var(--note-hover-color)] break-all">
                    Loading naddr:{id}
                  </div>
                )
              } else if (event) {
                return (
                  <FeedItem
                    event={event}
                    key={event.id}
                    standalone={true}
                    onEvent={addToThread}
                    showReplies={Infinity}
                  />
                )
              } else {
                return <div className="p-4">Failed to load naddr:{id}</div>
              }
            } else {
              return (
                <FeedItem
                  key={id}
                  eventId={id}
                  standalone={true}
                  onEvent={addToThread}
                  showReplies={Infinity}
                />
              )
            }
          })()}
        </div>
        <RightColumn>
          {() => (
            <>
              {isArticle && threadAuthor ? (
                <Widget title="More from this author" className="h-96">
                  <AuthorArticlesFeed
                    authorPubkey={threadAuthor}
                    currentArticleId={event?.id || id}
                    maxItems={5}
                  />
                </Widget>
              ) : (
                relevantPeople.size > 0 && (
                  <Widget title="Relevant people" className="h-96">
                    <FollowList
                      follows={Array.from(relevantPeople.keys())}
                      showAbout={true}
                    />
                  </Widget>
                )
              )}
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
        </RightColumn>
      </div>
    </div>
  )
}
