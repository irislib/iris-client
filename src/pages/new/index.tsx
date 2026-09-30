import Header from "@/shared/components/header/Header"
import InlineNoteCreator from "@/shared/components/create/InlineNoteCreator"
import {useNavigate} from "@/navigation"
import {AppEvent} from "@/lib/nostr"
import {nip19} from "nostr-tools"

function NewNote() {
  const navigate = useNavigate()

  const handlePublish = (event: AppEvent) => {
    // Navigate to the newly created post
    if (event?.id) {
      const nevent = nip19.neventEncode({
        id: event.id,
        kind: event.kind,
      })
      navigate(`/${nevent}`)
    }
  }

  return (
    <>
      <Header title="New Post" />
      <div className="flex-1 overflow-y-auto pt-[calc(4rem+env(safe-area-inset-top))] pb-[calc(4rem+env(safe-area-inset-bottom))] md:pt-0 md:pb-0">
        <InlineNoteCreator
          onPublish={handlePublish}
          placeholder="What's on your mind?"
          alwaysExpanded={true}
          showPreview={true}
        />
      </div>
    </>
  )
}

export default NewNote
