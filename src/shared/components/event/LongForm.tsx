import {NDKEvent} from "@/lib/ndk"
import Markdown from "markdown-to-jsx/react"
import ProxyImg from "../ProxyImg"
import {useNavigate} from "@/navigation"
import {nip19} from "nostr-tools"

interface LongFormProps {
  event: NDKEvent
  standalone: boolean | undefined
}

function LongForm({event, standalone}: LongFormProps) {
  const title = event.tagValue("title") || ""
  const topics = event.tagValue("t")
  const textBody = event.content || ""
  const summary = event.tagValue("summary") || ""
  const imageUrl = event.tagValue("image") || ""
  const navigate = useNavigate()

  const getDisplayContent = () => {
    if (standalone) {
      return textBody
    }

    if (summary) {
      return summary.length > 250 ? `${summary.substring(0, 250)}...` : summary
    }

    return `${textBody.substring(0, 250)}...`
  }

  const titleSize = standalone ? "text-3xl my-4" : "text-xl my-2"

  return (
    <>
      {imageUrl && standalone && (
        <ProxyImg
          src={imageUrl}
          alt={title || "Article image"}
          className="w-full object-cover h-64 lg:h-96 my-4"
          width={800}
        />
      )}
      <div className="flex flex-col gap-2 px-5">
        {!standalone && (
          <div
            className="cursor-pointer h-48 rounded-lg overflow-hidden bg-base-300"
            onClick={(e) => {
              e.stopPropagation()
              navigate(`/${nip19.noteEncode(event.id)}`)
            }}
          >
            {imageUrl ? (
              <ProxyImg
                src={imageUrl}
                alt={title || "Article preview"}
                className="w-full h-full object-cover hover:opacity-90 transition-opacity"
                width={400}
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-base-content/30">
                <svg
                  className="w-16 h-16"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.5}
                    d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z"
                  />
                </svg>
              </div>
            )}
          </div>
        )}
        <h1 className={`flex items-center gap-2 ${titleSize}`}>{title}</h1>
        <Markdown
          className="prose leading-relaxed tracking-wide text-gray-450 whitespace-pre-wrap break-words [overflow-wrap:anywhere]"
          options={{
            disableParsingRawHTML: true,
            forceBlock: true,
            overrides: {
              img: {
                component: ProxyImg,
                props: {
                  className: standalone
                    ? "w-full object-cover rounded"
                    : "h-48 w-full object-cover rounded",
                  width: 600,
                  loading: "lazy",
                },
              },
            },
          }}
        >
          {getDisplayContent()}
        </Markdown>
        {topics && <small className="text-custom-accent">#{topics}</small>}
      </div>
    </>
  )
}

export default LongForm
