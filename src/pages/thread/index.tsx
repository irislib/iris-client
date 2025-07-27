import FeedItem from "@/shared/components/event/FeedItem/FeedItem"
import RightColumn from "@/shared/components/RightColumn.tsx"
import PopularFeed from "@/shared/components/feed/PopularFeed"
import FollowList from "@/pages/user/components/FollowList"
import Header from "@/shared/components/header/Header"
import {Name} from "@/shared/components/user/Name"
import Widget from "@/shared/components/ui/Widget"
import {useSettingsStore} from "@/stores/settings"
import socialGraph from "@/utils/socialGraph"
import {NostrEvent, nip19} from "nostr-tools"
import {useState, useEffect} from "react"
import {getTags} from "@/utils/nostr"

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
  const [event] = useState<NostrEvent | null>(null)
  const [loading, setLoading] = useState(isNaddr)
  const [threadAuthor, setThreadAuthor] = useState<string | null>(null)

  useEffect(() => {
    setThreadAuthor(null)
  }, [id])

  useEffect(() => {
    if (isNaddr && naddrData) {
      setLoading(true)
      // applesauce.fetchEvent(
      //   {
      //     authors: [naddrData.pubkey],
      //     kinds: [naddrData.kind],
      //     "#d": [naddrData.identifier],
      //   },
      //   undefined
      // )
      //   .then((e) => {
      //     if (e) {
      //       setEvent(e)
      //       if (e.pubkey) {
      //         setThreadAuthor(e.pubkey)
      //         addRelevantPerson(e.pubkey)
      //       }
      //     }
      //     setLoading(false)
      //   })
      //   .catch((err) => {
      //     console.warn("Error fetching naddr event:", err)
      //     setLoading(false)
      //   })
    }
  }, [isNaddr, naddrData])

  const addRelevantPerson = (person: string) => {
    setRelevantPeople((prev) => new Map(prev).set(person, true))
  }

  const addToThread = (event: NostrEvent) => {
    if (
      content.hideEventsByUnknownUsers &&
      socialGraph().getFollowDistance(event.pubkey) > 5
    )
      return
    if (!threadAuthor) setThreadAuthor(event.pubkey)
    addRelevantPerson(event.pubkey)
    for (const user of getTags("p", event.tags)) {
      addRelevantPerson(user)
    }
  }

  return (
    <div className="flex justify-center">
      <div className="flex-1">
        <Header>
          {threadAuthor ? (
            <>
              Post by <Name className="-ml-3" pubKey={threadAuthor} />
            </>
          ) : (
            "Post"
          )}
        </Header>
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
            {relevantPeople.size > 0 && (
              <Widget title="Relevant people">
                <FollowList
                  follows={Array.from(relevantPeople.keys())}
                  showAbout={true}
                />
              </Widget>
            )}
            <Widget title="Popular">
              <PopularFeed />
            </Widget>
          </>
        )}
      </RightColumn>
    </div>
  )
}
