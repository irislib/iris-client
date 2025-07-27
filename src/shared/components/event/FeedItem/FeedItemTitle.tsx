import useProfile from "@/shared/hooks/useProfile.ts"
import {NostrEvent} from "nostr-tools"
import {Helmet} from "react-helmet"
import {useMemo} from "react"

type FeedItemTitleProps = {
  event?: NostrEvent
}

const FeedItemTitle = ({event}: FeedItemTitleProps) => {
  const authorProfile = useProfile(event?.pubkey)

  const authorTitle = useMemo(() => {
    const name =
      authorProfile?.name ||
      authorProfile?.display_name ||
      authorProfile?.username ||
      (authorProfile?.nip05 as string)?.split("@")[0]
    return name ? `Post by ${name}` : "Post"
  }, [authorProfile])

  return (
    <Helmet>
      <title>{authorTitle}</title>
    </Helmet>
  )
}

export default FeedItemTitle
