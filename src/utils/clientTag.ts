import {EventKind, type ClientOptions} from "@/lib/nostr"
import {useSettingsStore} from "@/stores/settings"

// Public publishing and engagement only. New kinds must opt in explicitly.
const attributedKinds = new Set<number>([
  EventKind.Text,
  EventKind.Repost,
  EventKind.GenericRepost,
  EventKind.Reaction,
  EventKind.Image,
  EventKind.GenericReply,
  EventKind.Article,
  EventKind.Classified,
  EventKind.ZapRequest,
])

export const irisClientTagOptions: Pick<ClientOptions, "clientName" | "clientTagFilter"> =
  {
    clientName: "iris",
    clientTagFilter: (event) =>
      useSettingsStore.getState().content.showClientTag !== false &&
      attributedKinds.has(event.kind) &&
      !event.tags.some((tag) => tag[0] === "anon"),
  }
