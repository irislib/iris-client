import {useRef} from "react"
import Embed from "./index.ts"
import {usePauseMediaWhenHidden} from "@/shared/hooks/usePauseMediaWhenHidden"

function AudioEmbed({match}: {match: string}) {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  usePauseMediaWhenHidden(audioRef)

  return (
    <audio ref={audioRef} className="my-2 mx-4" src={match} controls={true} loop={true} />
  )
}

const Audio: Embed = {
  regex: /(https?:\/\/\S+\.(?:mp3|wav|ogg|flac)(?:\?\S*)?)\b/gi,
  settingsKey: "enableAudio",
  component: ({match}) => <AudioEmbed match={match} />,
}

export default Audio
