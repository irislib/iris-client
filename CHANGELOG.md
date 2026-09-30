# Changelog

## 2.5.32 - 2026-09-30

- Label seed connections as FIPS WebSocket seeds and link to fips.network in Network settings.
- Shorten the bandwidth legend to Up and Down.
- Include WebSocket seeds in peer counts and avoid showing an empty peer state while connected to seeds.

## 2.5.31 - 2026-09-30

- Show connected peers alongside relays in the Network sidebar.
- Show WebRTC peers, seed connections, live bandwidth and session traffic in Network settings.
- Turn the connectivity indicator green when connected to peers and amber for server-only connections.

## 2.5.30 - 2026-09-30

- Keep the recovery wallet working offline when the web host redirects its entry page.
- Recover an older wallet cache when reopening it from Iris.
- Keep the recovery wallet usable when its signing device is offline.

## 2.5.29 - 2026-09-30

- Reuse message-server connections in the recovery wallet while keeping saved funds, keys, and signer sessions.
- Reopen a previously visited recovery wallet offline, including direct links.
- Keep recovery-wallet updates separate from other open Iris tabs.

## 2.5.28 - 2026-09-30

- Recover peer connections sooner when handshake messages or connection answers are lost.
- Retain linked-device names from the shared messaging runtime.
- Save new posts to the offline outbox before clearing the draft or opening the post.

## 2.5.27 - 2026-09-30

- Accept current native chat invites and direct messages, and use the shared group message format.
- Restore saved groups before processing incoming encrypted history.
- Keep removed group chats readable and stop their pending sends.
- Require message-server confirmation before marking outgoing messages as sent.
- Keep linked-device control messages out of conversation history.

## 2.5.26 - 2026-09-30

- Route larger peer connection offers over paths that can carry them.
- Resume peer connections promptly after authenticated signaling recovers.

## 2.5.25 - 2026-09-30

- Use the shared Nostr runtime for batched subscriptions, durable offline events, and peer-served files.
- Keep existing accounts and message sessions when upgrading.

## 2.5.24 - 2026-09-29

- Hide Groups from the Iris navigation menu.

## 2.5.23 - 2026-09-29

- Avoid repeatedly attempting to decrypt pending messages with unchanged chat
  session keys during startup, keeping feed loading responsive while chats sync.
  Messages are retried when the receiving session or its ratchet state changes.

## 2.5.22 - 2026-09-29

- Preserve relay connections and pending feed requests when returning after sleep
  or a paused page, instead of immediately restarting a healthy relay worker.
- Load embedded and local images directly, including resized avatars, without
  sending them to an image proxy that cannot fetch them.

## 2.5.21 - 2026-09-27

- Identify Iris with the standard lowercase client tag on public posts, replies,
  reposts, reactions, and public zap requests by default. Turn this off in
  Settings → Content → “Show Iris on my public activity”. Profiles, follow lists,
  private messages, and other unselected events remain untagged.

## 2.5.20 - 2026-09-27

- Show cached recommendation posts promptly when other posts in the same batch
  are unavailable, instead of holding the whole feed for the network timeout.

## 2.5.19 - 2026-09-17

- Show multiword search matches as soon as a complete word index finds them,
  without waiting for common terms or unrelated relays to finish.

## 2.5.18 - 2026-09-17

- Retry interrupted search pages without skipping recent history or replacing
  it with old hashtag results.
- Preserve all relay messages when search responses arrive in a burst.

## 2.5.17 - 2026-09-16

- Match complete words in post search and find multiword queries in any order.
- Collapse additional matches under each author so prolific accounts do not
  crowd out other results, while keeping every fetched match available to expand.
- Keep search rows stable during relay and network updates, and search newer
  history before displaying old cached or hashtag matches.

## 2.5.16 - 2026-09-07

- Update Hashtree to security runtime 0.5.7 with remote blob integrity checks.
- Include the verified Nostr Double Ratchet security update for encrypted messaging.

## 2.5.15

- Show search results from the default network for accounts with no follows,
  while honoring personal mutes and the unknown-user filter.
- Use a dedicated text-search source and keep search requests and pagination
  independent so old results cannot skip newer history.
- Continue searching past pages of nonmatches and offer an older-post search
  when the initial batches have no matches.
- Update the Hashtree runtime to the v0.5.7 security release.

## 2.5.14

- Speed up logout by skipping notification-worker waits when none is registered
  and running independent cleanup in parallel, while preserving device revocation
  and private-data cleanup.
- Show For You posts and recommendations from the default network before the
  first follow, honor personal mutes, and switch to the personal network when
  following someone.
- Remove the empty-follow prompt above recommendation feeds.

## 2.5.13

- Update nostr-double-ratchet to 0.0.169: send private messages after signing and
  saving locally. Relay delivery and retries run in the background, with queued
  encrypted messages preserved across reloads.
- Update nostr-social-graph to 2.0.1 for coalesced distance calculations and faster
  binary processing, remove the temporary graph patch, and avoid duplicate
  startup traversals.
- Fill short feeds and continue pagination when more relay candidates arrive,
  while keeping existing post order stable.

## 2.5.12

- Start restored For You feeds from the saved visibility graph without waiting
  for relay history completion, and show sparse candidates as they arrive.
- Keep social-graph distances and user counts complete during recalculation,
  coalesce repeated traversals, and ignore duplicate graph updates.
- Recover an initially empty For You feed when delayed relay posts arrive.
- Resume infinite scrolling after a short first batch or delayed relay candidates,
  and fill the viewport without reshuffling posts already shown.

## 2.5.11

- Start feed relay requests without waiting for unrelated profile, payment, or
  unpublished-event cache warmup, and bound unpublished-event memory loading.
- Display low-activity recommendations when relay history arrives instead of
  waiting for the five-second fallback.
- Restore active subscriptions after relay worker failures and avoid duplicate
  recovery attempts, completed-query replay, or restarting a closed runtime.
- Update the double-ratchet runtime to 0.0.168 so slow relay acknowledgements do
  not block incoming messages or peer discovery.
- Replace fixed draft and cache test pauses with persisted-state checks.

## 2.5.10

- Hide unknown and threshold-three overmuted identities from profile follows,
  thread people/articles, Popular, and Social Graph sidebar recommendations.
- Wait for the correct viewer or default graph before showing sidebar candidates,
  while preserving self and direct follows unless directly muted.
- Refresh sidebar visibility atomically on graph and setting changes without
  changing an already-loaded For You feed, and share the graph-policy scan across
  recommendation widgets.

## 2.5.9

- Hide notification replies, reactions, reposts, pictures, highlights, and zaps
  from unknown or overmuted senders, using the same threshold as profile warnings.
- Wait for the signed-in social graph before loading notification history and
  revalidate cached groups, badge state, account changes, and graph/settings updates.
- Preserve notifications from explicitly followed users unless directly muted,
  and attribute zap visibility to the actual sender instead of the receipt service.

## 2.5.8

- Restore the logged-out Popular feed by waiting for reaction-backed recommendations
  from the default Sirius social graph instead of letting its disabled chronological
  source complete an empty initial load.
- Keep mixed recommendation feeds retryable while an enabled source is still loading,
  settle quiet chronological windows, and fill underfull batches from whichever ready
  source has posts.

## 2.5.7

- Make For You wait for a settled social-graph snapshot and keep that snapshot
  stable until refresh, including across cold starts and account switches.
- Exclude unknown, muted, and overmuted note, reaction, and repost authors from
  recommendations; count unique visible actors and revalidate scoped feed caches.
- Add local-relay journeys for reaction/repost recommendations and graph warning
  parity, plus deterministic coverage for readiness, stale fetches, and auth races.
- Improve iOS feed and infinite-scroll performance, cached-event fetching, and
  service-worker startup behavior.
- Fix NIP-07 reactions on cached posts and surface reply-signing failures.
- Polish profile and read-only sidebar surfaces and update the double-ratchet
  runtime to 0.0.166.

## 2.5.6

- Upgrade the Cashu wallet to the maintained 3.7 LTS API, including cached wallet
  hydration, fee-correct token handling, atomic deterministic counters, restoration,
  and crash-safe Lightning payment recovery.
- Add fast cryptographic fake-mint journeys for mint, send, receive, duplicate-spend,
  melt, lost-response, signed-change, and restart-recovery behavior.
- Refresh compatible cryptography, Nostr, React, Markdown, and CSS tooling
  dependencies, move the supported runtime to Node 22, and clear the remaining
  dependency audit finding.
- Disable raw HTML and JSX parsing in untrusted long-form Nostr articles and add
  regression coverage for signatures, HMAC URLs, Cashu outputs, and hostile
  Markdown.
- Keep Tailwind and DaisyUI on their current stable major versions until their
  coordinated theme and plugin migration can be tested separately.

## 2.5.5

- Harden encrypted messaging startup, backfill deduplication, delivery status,
  device linking and revocation, and single-tab ratchet ownership.
- Add a production-like signup, post, reaction, session-restore, and navigation
  journey with browser performance metrics and faster parallel test gates.
- Serialize notification reconciliation, honor direct-message preferences, and
  report the browser's actual push-subscription state.
- Defer Cashu wallet code, shrink the service-worker precache by about 48%,
  preserve unrelated runtime caches, and accelerate feed and cache operations.
- Fix rapid follow publication races, corrupt-session recovery, signature
  verification recursion, and worker relay-status recovery.
- Replace the browser-opening bundle analyzer with concise CLI build output and
  remove redundant tests, unused dependencies, exports, and source files.

## 2.5.4

- Publish uploaded image metadata only when the exact media URL remains in the
  final post content, preventing removed composer images from leaking into
  ordinary notes and marketplace image tags.

## 2.5.3

- Pin the audited double-ratchet TypeScript 0.0.165 release and verify same-key messaging across two and three browser sessions.
- Remove 149 packages and the remaining development-lock advisory by running the pinned Lighthouse CLI on demand.
- Preserve pending same-origin notification navigation fixes and keep their service-worker implementation lint-clean.
- Share relay-readiness logic between private-message browser gates instead of depending on an optional header indicator.

## 2.5.2

- Pin Hashtree core and index, the shared social graph, and the double-ratchet runtime to immutable audited release archives.
- Route group rosters and messages through the runtime's authenticated group controller, removing the duplicate legacy metadata carrier.
- Replace the local Hashtree override graph and duplicate site-release driver with shared release tooling from Iris Kit.
- Refresh compatible dependencies and replace the full Node browser shim with the one required `buffer` import.
- Gate builds, tests, and releases on the expected archive URLs and checksums.
