import type {NDKConstructorParams} from "@/lib/ndk"
import {NDKKind} from "@/lib/ndk/events/kinds"
import {useSettingsStore} from "@/stores/settings"

// Public publishing and engagement only. New kinds must opt in explicitly.
const attributedKinds = new Set<number>([
  NDKKind.Text,
  NDKKind.Repost,
  NDKKind.GenericRepost,
  NDKKind.Reaction,
  NDKKind.Image,
  NDKKind.GenericReply,
  NDKKind.Article,
  NDKKind.Classified,
  NDKKind.ZapRequest,
])

export const irisClientTagOptions: Pick<
  NDKConstructorParams,
  "clientName" | "clientTagFilter"
> = {
  clientName: "iris",
  clientTagFilter: (event) =>
    useSettingsStore.getState().content.showClientTag !== false &&
    attributedKinds.has(event.kind) &&
    !event.tags.some((tag) => tag[0] === "anon"),
}
